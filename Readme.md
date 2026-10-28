# MediCare Hub

A responsive hospital-management platform built for secure healthcare workflows. It supports patient booking, doctor workflows, and administrative visibility while keeping authorization and appointment rules enforced by the API.

Live : https://medicarehub-uc2c.onrender.com/

## Stack

- React, Vite and vanilla CSS for a fast responsive interface
- Express and Mongoose for the API and MongoDB data access
- JWT + bcrypt for authenticated, role-based access
- Zod request validation and Jest tests

## Run locally

1. Copy `server/.env.example` to `server/.env` and provide the MongoDB connection string and a long JWT secret.
2. Copy `client/.env.example` to `client/.env` (the default local API address is already set).
3. Install packages with `npm install`, `npm install --prefix server`, and `npm install --prefix client`.
4. Import the provided source data with `npm run seed`. This deliberately resets the MediCare Hub collections in the configured database.
5. Start both apps with `npm run dev`.

The frontend runs at `http://localhost:5173`, and the API runs at `http://localhost:5000`.

## Development accounts

After seeding, every account in `mock_data.json` has the password `MediCare@123`.

- Admin: `ravi.admin@example.com`
- Doctor: `sunita.sharma@example.com` or `amit.patel@example.com`
- Patient: `priya.singh@example.com`, `vikram.desai@example.com`, or `neha.gupta@example.com`
- Demo password: `MediCare@123`



## Important security design

- Patient identity is derived from their verified JWT, not a body parameter or URL identifier.
- Doctors only view or create records/prescriptions tied to their own appointments.
- Fees are calculated from the doctor record on the server; clients cannot submit prices.
- Booking validates doctor status, future date, schedule day, slot boundaries, and active patient status.
- A database-level partial unique index on `(doctorId, appointmentDate, startTime)` prevents concurrent duplicate bookings. A race loser receives HTTP `409`.
- Completed appointments cannot be cancelled. Records and prescriptions require the doctor’s completed appointment.

## Tests

Run `npm test`. The API has centralized validation/error handling, and unit tests cover scheduling primitives. The endpoint design is also intentionally safe for direct API testing.


## Deployment Notes

Deploy the frontend (`client`) as a Render Static Site and the backend (`server`) as a Render Web Service, both connected to the same GitHub repository.

- **Frontend:** [MedicareHub](https://medicarehub-uc2c.onrender.com)
- **Backend API:** [MedicareHub API](https://medicarehub-api.onrender.com)

Configure the following environment variables:

- **Frontend (Render Static Site):** `VITE_API_URL=https://medicarehub-api.onrender.com/api`
- **Backend (Render Web Service):** `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_URL=https://medicarehub-uc2c.onrender.com`

Keep environment variables and database credentials out of version control. Never commit `.env` files or expose secrets in the frontend.

## 👨‍💻 Author

**Abhinay Srivastava**

- GitHub: https://github.com/abhina-y
- LinkedIn: https://www.linkedin.com/in/abhinay-srivastava-bb0206290/

---
