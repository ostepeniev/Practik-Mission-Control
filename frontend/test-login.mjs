fetch('http://127.0.0.1:3002/api/auth/login', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({username: 'dev', password: 'dev123'})
}).then(r => r.text()).then(d => console.log('LOGIN:', d)).catch(e => console.error(e));
