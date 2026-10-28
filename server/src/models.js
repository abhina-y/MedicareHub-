import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const timestamps = { timestamps: true, versionKey: false };

export const User = model('User', new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'DOCTOR', 'PATIENT'], required: true },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
}, timestamps));

export const Doctor = model('Doctor', new Schema({
  doctorId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  specialization: { type: String, required: true },
  registrationNumber: { type: String, required: true, unique: true },
  consultationFee: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
}, timestamps));

export const Patient = model('Patient', new Schema({
  patientId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
  phone: { type: String },
  bloodGroup: { type: String },
  emergencyContact: { type: String },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
}, timestamps));

export const Availability = model('Availability', new Schema({
  availabilityId: { type: String, required: true, unique: true },
  doctorId: { type: String, required: true, index: true },
  day: { type: String, enum: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'], required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  slotDurationMinutes: { type: Number, required: true, min: 5, max: 120 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
}, timestamps));

const appointmentSchema = new Schema({
  appointmentId: { type: String, required: true, unique: true, index: true },
  patientId: { type: String, required: true, index: true },
  doctorId: { type: String, required: true, index: true },
  appointmentDate: { type: String, required: true, index: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  consultationFee: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['CONFIRMED', 'COMPLETED', 'CANCELLED'], default: 'CONFIRMED' },
  reason: { type: String, required: true, trim: true, maxlength: 500 }
}, timestamps);
// The database, rather than the browser, has the final say on a bookable slot.
appointmentSchema.index({ doctorId: 1, appointmentDate: 1, startTime: 1 }, {
  unique: true,
  partialFilterExpression: { status: { $in: ['CONFIRMED', 'COMPLETED'] } }
});
export const Appointment = model('Appointment', appointmentSchema);

export const MedicalRecord = model('MedicalRecord', new Schema({
  recordId: { type: String, required: true, unique: true },
  patientId: { type: String, required: true, index: true },
  doctorId: { type: String, required: true, index: true },
  appointmentId: { type: String, required: true, unique: true },
  diagnosis: { type: String, required: true, maxlength: 1000 },
  symptoms: { type: String, required: true, maxlength: 2000 },
  notes: { type: String, required: true, maxlength: 5000 },
  status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' }
}, timestamps));

const medicineSchema = new Schema({
  medicineName: { type: String, required: true, trim: true },
  dosage: { type: String, required: true, trim: true },
  frequency: { type: String, required: true, trim: true },
  durationDays: { type: Number, required: true, min: 1, max: 365 },
  quantity: { type: Number, required: true, min: 1, max: 10000 }
}, { _id: false });
export const Prescription = model('Prescription', new Schema({
  prescriptionId: { type: String, required: true, unique: true },
  patientId: { type: String, required: true, index: true },
  doctorId: { type: String, required: true, index: true },
  appointmentId: { type: String, required: true, unique: true },
  // Imported draft prescriptions may be empty; the create API separately requires at least one valid medicine.
  medicines: { type: [medicineSchema], default: [] },
  status: { type: String, enum: ['ACTIVE', 'COMPLETED'], default: 'ACTIVE' }
}, timestamps));

export const AuditLog = model('AuditLog', new Schema({
  actorUserId: { type: String, required: true, index: true },
  action: { type: String, required: true },
  resourceType: { type: String, required: true },
  resourceId: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 1000 },
  changes: { type: Schema.Types.Mixed, default: {} }
}, timestamps));
