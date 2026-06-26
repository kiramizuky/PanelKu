import 'dotenv/config';

export default {
  uri: process.env.MONGO_URI || 'mongodb://localhost:27017/linux-panel',
  options: {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  },
};
