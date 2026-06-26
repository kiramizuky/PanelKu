import mongoose from 'mongoose';
import dbConfig from './src/config/database.js';
import User from './src/models/User.js';

async function test() {
  await mongoose.connect(dbConfig.uri);
  const user = await User.findOne({ username: 'admin' }, '+password');
  console.log('User found:', !!user);
  if (user) {
    const isMatch = await user.comparePassword('Admin@123456');
    console.log('Password match:', isMatch);
  }
  process.exit();
}
test();
