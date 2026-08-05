const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4MDFhOGQwZC1mMmFiLTRlNzUtYWYxNy0zODJjZGNkYzliOWEiLCJpYXQiOjE3ODU5MDAyODYsImV4cCI6MTc4ODQ5MjI4Nn0.942cFhA5BJ4rAyjFbdcD7EMhrUZkt2Iq3KbSU7XeKEk';
const r = await fetch('http://localhost:23456/api/auth/profile', {
  headers: { Authorization: 'Bearer ' + token }
});
const j = await r.json();
console.log('STATUS:', r.status, 'SUCCESS:', j.success, j.message || '');
if (j.data?.user) console.log('USER:', j.data.user.username, j.data.user.is_super_admin);
process.exit(0);
