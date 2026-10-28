import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../db.js';
import { User, Doctor, Patient, Availability, Appointment, MedicalRecord, Prescription } from '../models.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const camel = obj => Object.fromEntries(Object.entries(obj).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));

try {
  await connectDatabase();
  const source = JSON.parse(await fs.readFile(path.join(root, 'mock_data.json'), 'utf8'));
  const password = await bcrypt.hash('MediCare@123', 12);
  await Promise.all([User, Doctor, Patient, Availability, Appointment, MedicalRecord, Prescription].map(model => model.deleteMany({})));
  await User.insertMany(source.users.map(user => ({ ...camel(user), password })));
  await Doctor.insertMany(source.doctors.map(camel));
  await Patient.insertMany(source.patients.map(item => ({ ...camel(item), dateOfBirth: item.date_of_birth ? new Date(item.date_of_birth) : undefined })));
  await Availability.insertMany(source.doctor_availability.map(camel));
  await Appointment.insertMany(source.appointments.map(camel));
  await MedicalRecord.insertMany(source.medical_records.map(camel));
  await Prescription.insertMany(source.prescriptions.map(item => ({ ...camel(item), medicines: item.medicines.map(camel) })));
  await Promise.all([User, Doctor, Patient, Availability, Appointment, MedicalRecord, Prescription].map(model => model.syncIndexes()));
  console.log('Seed complete. Development password for every supplied account: MediCare@123');
} catch (error) { console.error('Seed failed:', error); process.exitCode = 1; }
finally { await disconnectDatabase(); }
