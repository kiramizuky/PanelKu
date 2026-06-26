import mongoose from 'mongoose';

const metricSchema = new mongoose.Schema({
  cpu: Number,
  cpuTemp: Number,
  ramUsed: Number,
  ramTotal: Number,
  swapUsed: Number,
  swapTotal: Number,
  diskUsed: Number,
  diskTotal: Number,
  networkRx: Number, // bytes/s
  networkTx: Number, // bytes/s
  diskRead: Number,  // bytes/s
  diskWrite: Number, // bytes/s
  loadAvg: [Number],
}, { _id: false });

const monitorHistorySchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  metrics: metricSchema,
}, {
  capped: { size: 10485760, max: 10000 }, // 10MB capped collection
});

const MonitorHistory = mongoose.model('MonitorHistory', monitorHistorySchema);
export default MonitorHistory;
