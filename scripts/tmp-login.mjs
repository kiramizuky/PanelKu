const r = await (await fetch('http://localhost:23456/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'verifyadmin', password: 'Verify@12345' })
})).json();
if (!r.success) {
  console.log('LOGIN FAILED:', JSON.stringify(r).substring(0, 300));
  process.exit(1);
}
console.log('TOKEN=' + r.data.accessToken);
process.exit(0);
