import mongoose from 'mongoose';

const SourceSchema = new mongoose.Schema({
  id: String, url: String, title: String, domain: String, tier: Number
}, { _id: false });

const ClaimSchema = new mongoose.Schema({
  text: String,
  timestamp: Number,
  origin: { type: String, enum: ['speech', 'screen'] },
  verdict: { type: String, enum: ['true', 'false', 'misleading', 'unverified'], default: 'unverified' },
  explanation: String,
  sources: [SourceSchema],
  citationValid: { type: Boolean, default: true }
}, { _id: false });

const JobSchema = new mongoose.Schema({
  videoPath: String,
  status: { type: String, enum: ['processing', 'done', 'failed'], default: 'processing' },
  transcript: String,
  ocrText: [String],
  error: String,
  claims: [ClaimSchema]
}, { timestamps: true });

export default mongoose.model('Job', JobSchema);
