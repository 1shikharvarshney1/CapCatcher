import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import jobsRouter from './routes/jobs.js';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

fs.mkdirSync('uploads', { recursive: true });
fs.mkdirSync('uploads/frames', { recursive: true });

app.use('/api/jobs', jobsRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 5001;

let mongodInstance = null;

async function getMongoUri() {
  const uri = process.env.MONGODB_URI?.trim();
  if (uri) return uri;
  // Dev mode: spin up in-memory MongoDB (no account needed)
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongodInstance = await MongoMemoryServer.create();
  const memUri = mongodInstance.getUri();
  console.log('[Dev] In-memory MongoDB started at', memUri);
  return memUri;
}

getMongoUri()
  .then(uri => mongoose.connect(uri))
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
