import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User, Doctor, Patient, Availability, Appointment, MedicalRecord, Prescription, AuditLog } from './models.js';
import { authenticate, allow, activeUser } from './middleware/auth.js';
import { asMinutes, dateDay, isFutureDate, newId, timeFromMinutes } from './utils.js';

const app = express();
app.use(cors({ origin: (process.env.CLIENT_URL || 'http://localhost:5173').split(','), credentials: true }));
app.use(express.json({ limit: '100kb' }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const validation = schema => (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request data', details: parsed.error.flatten().fieldErrors });
  req.body = parsed.data; next();
};
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(100) });
const bookSchema = z.object({ doctorId: z.string().min(1), appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/), reason: z.string().min(3).max(500) });
const medicineSchema = z.object({ medicineName: z.string().min(2).max(150), dosage: z.string().min(1).max(100), frequency: z.string().min(2).max(100), durationDays: z.number().int().min(1).max(365), quantity: z.number().int().min(1).max(10000) });
const recordSchema = z.object({ appointmentId: z.string().min(1), diagnosis: z.string().min(2).max(1000), symptoms: z.string().min(2).max(2000), notes: z.string().min(2).max(5000) });
const prescriptionSchema = z.object({ appointmentId: z.string().min(1), medicines: z.array(medicineSchema).min(1).max(20) });
const doctorCreateSchema = z.object({
  name: z.string().min(3).max(100), email: z.string().email(), password: z.string().min(8).max(100),
  specialization: z.string().min(3).max(100), registrationNumber: z.string().min(3).max(60), consultationFee: z.number().min(0).max(100000)
});
const patientRegistrationSchema = z.object({
  name: z.string().min(3).max(100), email: z.string().email(), password: z.string().min(8).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  phone: z.string().min(7).max(30), bloodGroup: z.string().min(1).max(10), emergencyContact: z.string().min(7).max(30)
});
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']), reason: z.string().min(3).max(500) });
const prescriptionUpdateSchema = z.object({ medicines: z.array(medicineSchema).min(1).max(20), reason: z.string().min(3).max(1000) });

function tokenFor(user) { return jwt.sign({ userId: user.userId, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '8h' }); }
async function patientFor(userId) { return Patient.findOne({ userId, status: 'ACTIVE' }); }
async function doctorFor(userId) { return Doctor.findOne({ userId, status: 'ACTIVE' }); }
function scrubUser(user) { return { userId: user.userId, name: user.name, email: user.email, role: user.role }; }

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'MediCare Hub API' }));
app.post('/api/auth/login', validation(loginSchema), asyncRoute(async (req, res) => {
  const user = await User.findOne({ email: req.body.email.toLowerCase(), status: 'ACTIVE' }).select('+password');
  if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ error: 'Incorrect email or password' });
  res.json({ token: tokenFor(user), user: scrubUser(user) });
}));
app.post('/api/auth/register', validation(patientRegistrationSchema), asyncRoute(async (req, res) => {
  const { name, email, password, dateOfBirth, gender, phone, bloodGroup, emergencyContact } = req.body;
  if (new Date(`${dateOfBirth}T00:00:00`) >= new Date()) return res.status(422).json({ error: 'Date of birth must be in the past' });
  const session = await mongoose.startSession();
  try {
    let user;
    await session.withTransaction(async () => {
      const userId = newId('USR');
      [user] = await User.create([{ userId, name, email: email.toLowerCase(), password: await bcrypt.hash(password, 12), role: 'PATIENT', status: 'ACTIVE' }], { session });
      await Patient.create([{ patientId: newId('PAT'), userId: user.userId, name, dateOfBirth: new Date(dateOfBirth), gender, phone, bloodGroup, emergencyContact, status: 'ACTIVE' }], { session });
    });
    res.status(201).json({ token: tokenFor(user), user: scrubUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with this email already exists' });
    throw error;
  } finally { await session.endSession(); }
}));
app.get('/api/auth/me', authenticate, activeUser, asyncRoute(async (req, res) => {
  const profile = req.user.role === 'PATIENT' ? await patientFor(req.user.userId) : req.user.role === 'DOCTOR' ? await doctorFor(req.user.userId) : null;
  res.json({ user: scrubUser(req.user), profile });
}));

app.get('/api/doctors', authenticate, activeUser, asyncRoute(async (req, res) => {
  const doctors = await Doctor.find({ status: 'ACTIVE' }).sort({ name: 1 });
  res.json({ doctors });
}));
app.get('/api/doctors/:doctorId/slots', authenticate, activeUser, asyncRoute(async (req, res) => {
  const { doctorId } = req.params; const { date } = req.query;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'A valid date is required' });
  const doctor = await Doctor.findOne({ doctorId, status: 'ACTIVE' });
  if (!doctor) return res.status(404).json({ error: 'Active doctor not found' });
  const availability = await Availability.findOne({ doctorId, day: dateDay(date), status: 'ACTIVE' });
  if (!availability) return res.json({ slots: [] });
  const booked = await Appointment.find({ doctorId, appointmentDate: date, status: { $in: ['CONFIRMED', 'COMPLETED'] } }).select('startTime -_id');
  const occupied = new Set(booked.map(a => a.startTime));
  const slots = [];
  for (let start = asMinutes(availability.startTime); start + availability.slotDurationMinutes <= asMinutes(availability.endTime); start += availability.slotDurationMinutes) {
    const startTime = timeFromMinutes(start);
    slots.push({ startTime, endTime: timeFromMinutes(start + availability.slotDurationMinutes), available: !occupied.has(startTime) });
  }
  res.json({ doctorId, date, consultationFee: doctor.consultationFee, slots });
}));

app.post('/api/appointments', authenticate, activeUser, allow('PATIENT'), validation(bookSchema), asyncRoute(async (req, res) => {
  const patient = await patientFor(req.user.userId);
  if (!patient) return res.status(403).json({ error: 'Patient profile is not available' });
  const { doctorId, appointmentDate, startTime, reason } = req.body;
  if (!isFutureDate(appointmentDate)) return res.status(422).json({ error: 'Appointments must be booked for a future date' });
  const doctor = await Doctor.findOne({ doctorId, status: 'ACTIVE' });
  if (!doctor) return res.status(404).json({ error: 'Active doctor not found' });
  const availability = await Availability.findOne({ doctorId, day: dateDay(appointmentDate), status: 'ACTIVE' });
  if (!availability) return res.status(422).json({ error: 'Doctor is not available on this day' });
  const start = asMinutes(startTime), duration = availability.slotDurationMinutes, end = start + duration;
  if (start < asMinutes(availability.startTime) || end > asMinutes(availability.endTime) || (start - asMinutes(availability.startTime)) % duration !== 0) return res.status(422).json({ error: 'The requested time is outside the doctor’s available slots' });
  const session = await mongoose.startSession();
  try {
    let appointment;
    await session.withTransaction(async () => {
      [appointment] = await Appointment.create([{ appointmentId: newId('APT'), patientId: patient.patientId, doctorId, appointmentDate, startTime, endTime: timeFromMinutes(end), consultationFee: doctor.consultationFee, reason, status: 'CONFIRMED' }], { session });
    });
    return res.status(201).json({ appointment });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'This appointment slot is no longer available. Please select another time.' });
    throw error;
  } finally { await session.endSession(); }
}));
app.get('/api/appointments', authenticate, activeUser, asyncRoute(async (req, res) => {
  let filter = {};
  if (req.user.role === 'PATIENT') { const patient = await patientFor(req.user.userId); filter.patientId = patient?.patientId || '__none__'; }
  if (req.user.role === 'DOCTOR') { const doctor = await doctorFor(req.user.userId); filter.doctorId = doctor?.doctorId || '__none__'; }
  const appointments = await Appointment.find(filter).sort({ appointmentDate: -1, startTime: -1 });
  res.json({ appointments });
}));
app.patch('/api/appointments/:appointmentId/cancel', authenticate, activeUser, asyncRoute(async (req, res) => {
  const appointment = await Appointment.findOne({ appointmentId: req.params.appointmentId });
  if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
  const patient = req.user.role === 'PATIENT' ? await patientFor(req.user.userId) : null;
  const doctor = req.user.role === 'DOCTOR' ? await doctorFor(req.user.userId) : null;
  if (req.user.role !== 'ADMIN' && appointment.patientId !== patient?.patientId && appointment.doctorId !== doctor?.doctorId) return res.status(403).json({ error: 'You cannot change this appointment' });
  if (appointment.status === 'COMPLETED') return res.status(422).json({ error: 'Completed appointments cannot be cancelled' });
  if (appointment.status === 'CANCELLED') return res.status(422).json({ error: 'This appointment is already cancelled' });
  appointment.status = 'CANCELLED'; await appointment.save(); res.json({ appointment });
}));

app.get('/api/medical-records', authenticate, activeUser, asyncRoute(async (req, res) => {
  let filter = {};
  if (req.user.role === 'PATIENT') { const patient = await patientFor(req.user.userId); filter.patientId = patient?.patientId || '__none__'; }
  if (req.user.role === 'DOCTOR') { const doctor = await doctorFor(req.user.userId); filter.doctorId = doctor?.doctorId || '__none__'; }
  res.json({ records: await MedicalRecord.find(filter).sort({ createdAt: -1 }) });
}));
app.post('/api/medical-records', authenticate, activeUser, allow('DOCTOR'), validation(recordSchema), asyncRoute(async (req, res) => {
  const doctor = await doctorFor(req.user.userId); const appointment = await Appointment.findOne({ appointmentId: req.body.appointmentId, doctorId: doctor?.doctorId, status: 'COMPLETED' });
  if (!appointment) return res.status(422).json({ error: 'A completed appointment assigned to you is required' });
  const record = await MedicalRecord.create({ recordId: newId('REC'), patientId: appointment.patientId, doctorId: doctor.doctorId, appointmentId: appointment.appointmentId, ...req.body });
  res.status(201).json({ record });
}));
app.get('/api/prescriptions', authenticate, activeUser, asyncRoute(async (req, res) => {
  let filter = {};
  if (req.user.role === 'PATIENT') { const patient = await patientFor(req.user.userId); filter.patientId = patient?.patientId || '__none__'; }
  if (req.user.role === 'DOCTOR') { const doctor = await doctorFor(req.user.userId); filter.doctorId = doctor?.doctorId || '__none__'; }
  res.json({ prescriptions: await Prescription.find(filter).sort({ createdAt: -1 }) });
}));

// Administrative oversight and doctor schedule management stay protected on the API.
app.get('/api/patients', authenticate, activeUser, allow('ADMIN'), asyncRoute(async (req, res) => {
  res.json({ patients: await Patient.find().sort({ name: 1 }) });
}));
app.post('/api/admin/doctors', authenticate, activeUser, allow('ADMIN'), validation(doctorCreateSchema), asyncRoute(async (req, res) => {
  const { name, email, password, specialization, registrationNumber, consultationFee } = req.body;
  const session = await mongoose.startSession();
  try {
    let doctor;
    await session.withTransaction(async () => {
      const userId = newId('USR');
      const [user] = await User.create([{ userId, name, email: email.toLowerCase(), password: await bcrypt.hash(password, 12), role: 'DOCTOR' }], { session });
      [doctor] = await Doctor.create([{ doctorId: newId('DOC'), userId: user.userId, name, specialization, registrationNumber, consultationFee, status: 'ACTIVE' }], { session });
    });
    res.status(201).json({ doctor });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with this email or registration number already exists' });
    throw error;
  } finally { await session.endSession(); }
}));
app.patch('/api/admin/doctors/:doctorId/status', authenticate, activeUser, allow('ADMIN'), validation(statusSchema), asyncRoute(async (req, res) => {
  const doctor = await Doctor.findOneAndUpdate({ doctorId: req.params.doctorId }, { status: req.body.status }, { new: true });
  if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
  await User.updateOne({ userId: doctor.userId }, { status: req.body.status });
  await AuditLog.create({ actorUserId: req.user.userId, action: `DOCTOR_${req.body.status}`, resourceType: 'DOCTOR', resourceId: doctor.doctorId, reason: req.body.reason });
  res.json({ doctor });
}));
app.patch('/api/admin/patients/:patientId/status', authenticate, activeUser, allow('ADMIN'), validation(statusSchema), asyncRoute(async (req, res) => {
  const patient = await Patient.findOneAndUpdate({ patientId: req.params.patientId }, { status: req.body.status }, { new: true });
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  await User.updateOne({ userId: patient.userId }, { status: req.body.status });
  await AuditLog.create({ actorUserId: req.user.userId, action: `PATIENT_${req.body.status}`, resourceType: 'PATIENT', resourceId: patient.patientId, reason: req.body.reason });
  res.json({ patient });
}));
app.get('/api/availability', authenticate, activeUser, allow('DOCTOR'), asyncRoute(async (req, res) => {
  const doctor = await doctorFor(req.user.userId);
  res.json({ availability: await Availability.find({ doctorId: doctor?.doctorId }).sort({ day: 1, startTime: 1 }) });
}));
app.patch('/api/availability/:availabilityId', authenticate, activeUser, allow('DOCTOR'), validation(z.object({ startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), slotDurationMinutes: z.number().int().min(5).max(120), status: z.enum(['ACTIVE', 'INACTIVE']) })), asyncRoute(async (req, res) => {
  const doctor = await doctorFor(req.user.userId);
  if (asMinutes(req.body.startTime) >= asMinutes(req.body.endTime) || (asMinutes(req.body.endTime) - asMinutes(req.body.startTime)) % req.body.slotDurationMinutes !== 0) return res.status(422).json({ error: 'Availability must contain whole slots with a valid time range' });
  const availability = await Availability.findOneAndUpdate({ availabilityId: req.params.availabilityId, doctorId: doctor?.doctorId }, req.body, { new: true });
  if (!availability) return res.status(404).json({ error: 'Availability record not found' });
  res.json({ availability });
}));
app.post('/api/prescriptions', authenticate, activeUser, allow('DOCTOR'), validation(prescriptionSchema), asyncRoute(async (req, res) => {
  const doctor = await doctorFor(req.user.userId); const appointment = await Appointment.findOne({ appointmentId: req.body.appointmentId, doctorId: doctor?.doctorId, status: 'COMPLETED' });
  if (!appointment) return res.status(422).json({ error: 'A completed appointment assigned to you is required' });
  const prescription = await Prescription.create({ prescriptionId: newId('RX'), patientId: appointment.patientId, doctorId: doctor.doctorId, appointmentId: appointment.appointmentId, medicines: req.body.medicines });
  res.status(201).json({ prescription });
}));
app.patch('/api/prescriptions/:prescriptionId', authenticate, activeUser, validation(prescriptionUpdateSchema), asyncRoute(async (req, res) => {
  const prescription = await Prescription.findOne({ prescriptionId: req.params.prescriptionId });
  if (!prescription) return res.status(404).json({ error: 'Prescription not found' });
  const doctor = req.user.role === 'DOCTOR' ? await doctorFor(req.user.userId) : null;
  const ownsPrescription = doctor?.doctorId === prescription.doctorId;
  if (!ownsPrescription && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'You cannot modify this prescription' });
  if (prescription.status === 'COMPLETED' && req.user.role !== 'ADMIN') return res.status(422).json({ error: 'Completed prescriptions require an authorized clinical override' });
  prescription.medicines = req.body.medicines; await prescription.save();
  await AuditLog.create({ actorUserId: req.user.userId, action: req.user.role === 'ADMIN' ? 'PRESCRIPTION_ADMIN_CORRECTION' : 'PRESCRIPTION_UPDATED', resourceType: 'PRESCRIPTION', resourceId: prescription.prescriptionId, reason: req.body.reason, changes: { medicines: req.body.medicines } });
  res.json({ prescription });
}));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'An unexpected server error occurred' }); });
export default app;
