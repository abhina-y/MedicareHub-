import 'dotenv/config';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import { connectDatabase, disconnectDatabase } from '../db.js';
import { Appointment, AuditLog, Availability, Doctor, MedicalRecord, Patient, Prescription, User } from '../models.js';
import { dateDay, localIsoDate } from '../utils.js';

const ids = { doctorUser: 'QA-USR-DOCTOR', patientOneUser: 'QA-USR-P1', patientTwoUser: 'QA-USR-P2', doctor: 'QA-DOC-001', patientOne: 'QA-PAT-001', patientTwo: 'QA-PAT-002' };
const emails = ['qa.doctor@medicare.test', 'qa.patient.one@medicare.test', 'qa.patient.two@medicare.test', 'qa.registered@medicare.test'];
const password = 'SafePass@123';
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const date = localIsoDate(tomorrow);

async function cleanup() {
  await Promise.all([
    Appointment.deleteMany({ doctorId: ids.doctor }), Availability.deleteMany({ doctorId: ids.doctor }), Doctor.deleteMany({ doctorId: ids.doctor }),
    Patient.deleteMany({ patientId: { $in: [ids.patientOne, ids.patientTwo] } }), User.deleteMany({ email: { $in: emails } }),
    MedicalRecord.deleteMany({ doctorId: ids.doctor }), Prescription.deleteMany({ doctorId: ids.doctor }),
    AuditLog.deleteMany({ resourceId: { $in: [ids.doctor, ids.patientOne, ids.patientTwo] } })
  ]);
}

try {
  await connectDatabase();
  await cleanup();
  const hash = await bcrypt.hash(password, 10);
  await User.create([
    { userId: ids.doctorUser, name: 'Dr. QA', email: emails[0], password: hash, role: 'DOCTOR' },
    { userId: ids.patientOneUser, name: 'QA Patient One', email: emails[1], password: hash, role: 'PATIENT' },
    { userId: ids.patientTwoUser, name: 'QA Patient Two', email: emails[2], password: hash, role: 'PATIENT' }
  ]);
  await Doctor.create({ doctorId: ids.doctor, userId: ids.doctorUser, name: 'Dr. QA', specialization: 'Testing', registrationNumber: 'QA-REG-001', consultationFee: 750 });
  await Patient.create([
    { patientId: ids.patientOne, userId: ids.patientOneUser, name: 'QA Patient One', status: 'ACTIVE' },
    { patientId: ids.patientTwo, userId: ids.patientTwoUser, name: 'QA Patient Two', status: 'ACTIVE' }
  ]);
  await Availability.create({ availabilityId: 'QA-AVL-001', doctorId: ids.doctor, day: dateDay(date), startTime: '09:00', endTime: '11:00', slotDurationMinutes: 30 });
  await Appointment.syncIndexes();

  const login = async email => (await request(app).post('/api/auth/login').send({ email, password })).body.token;
  const [tokenOne, tokenTwo, doctorToken] = await Promise.all([login(emails[1]), login(emails[2]), login(emails[0])]);
  assert.ok(tokenOne && tokenTwo && doctorToken, 'seeded credentials must authenticate');

  const raceBody = { doctorId: ids.doctor, appointmentDate: date, startTime: '09:00', reason: 'Concurrency verification' };
  const race = await Promise.all([
    request(app).post('/api/appointments').set('Authorization', `Bearer ${tokenOne}`).send(raceBody),
    request(app).post('/api/appointments').set('Authorization', `Bearer ${tokenTwo}`).send(raceBody)
  ]);
  assert.deepEqual(race.map(result => result.status).sort(), [201, 409], 'exactly one simultaneous booking must win');
  const winner = race.find(result => result.status === 201).body.appointment;
  assert.equal(winner.consultationFee, 750, 'server must calculate the consultation fee');

  const past = await request(app).post('/api/appointments').set('Authorization', `Bearer ${tokenTwo}`).send({ ...raceBody, appointmentDate: '2020-01-01', startTime: '09:30' });
  assert.equal(past.status, 422, 'past bookings must be rejected');
  const outsideHours = await request(app).post('/api/appointments').set('Authorization', `Bearer ${tokenTwo}`).send({ ...raceBody, startTime: '08:00' });
  assert.equal(outsideHours.status, 422, 'outside-hours bookings must be rejected');
  const attackerToken = winner.patientId === ids.patientOne ? tokenTwo : tokenOne;
  const forbiddenCancel = await request(app).patch(`/api/appointments/${winner.appointmentId}/cancel`).set('Authorization', `Bearer ${attackerToken}`);
  assert.equal(forbiddenCancel.status, 403, 'patients must not cancel another patient’s appointment');
  const doctorRecordAttempt = await request(app).post('/api/medical-records').set('Authorization', `Bearer ${tokenOne}`).send({ appointmentId: winner.appointmentId, diagnosis: 'Test diagnosis', symptoms: 'Test symptoms', notes: 'Test notes' });
  assert.equal(doctorRecordAttempt.status, 403, 'patients must not create medical records');
  const registration = await request(app).post('/api/auth/register').send({ name: 'QA Registered Patient', email: emails[3], password, dateOfBirth: '1995-01-01', gender: 'OTHER', phone: '+911234567890', bloodGroup: 'O+', emergencyContact: '+911234567891', role: 'ADMIN' });
  assert.equal(registration.status, 201, 'new patient registration must work');
  assert.equal(registration.body.user.role, 'PATIENT', 'registration must never accept a client-supplied elevated role');
  console.log('Verification passed: authentication, registration, authorization, booking validation, server pricing, and concurrent booking protection all passed.');
} catch (error) {
  console.error('Verification failed:', error.message);
  process.exitCode = 1;
} finally {
  await cleanup().catch(() => undefined);
  await disconnectDatabase();
}
