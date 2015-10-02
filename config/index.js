const fs = require('fs');
const path = require('path');

module.exports = {
  env: process.env.NODE_ENV || 'development',
  cert_domain: 'MIT.EDU',
  course_dir: path.join(__dirname, '..', 'courses'),
  data_dir: path.join(__dirname, '..', 'data'),
  db_schema: fs.readFileSync(path.join(__dirname, 'db-schema.sql'), { encoding: 'utf8' }),
  db_select: {
    grade: fs.readFileSync(path.join(__dirname, 'db-select-grade.sql'), { encoding: 'utf8' }),
    inputs: fs.readFileSync(path.join(__dirname, 'db-select-inputs.sql'), { encoding: 'utf8' }),
  },
};
