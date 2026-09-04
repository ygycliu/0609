
const pg = require('pg');
const fs = require('fs');
const env = fs.readFileSync('/opt/ai-consulting-center/.env','utf8');
const m = env.match(/DATABASE_URL=(.*)/);
const c = new pg.Client({connectionString: m[1]});
c.connect().then(()=>c.query('SELECT id, username, role FROM employees WHERE role=\'admin\' LIMIT 5'))
  .then(r=>{console.log(JSON.stringify(r.rows));c.end();});
