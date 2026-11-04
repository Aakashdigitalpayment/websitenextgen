-- HRM: departments, employees, contracts, documents, leave (per tenant)
CREATE TABLE IF NOT EXISTS hrm_departments (
  id SERIAL PRIMARY KEY,
  name_np VARCHAR(150) NOT NULL,
  name_en VARCHAR(150),
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hrm_employees (
  id SERIAL PRIMARY KEY,
  employee_code VARCHAR(40) NOT NULL UNIQUE,
  full_name VARCHAR(200) NOT NULL,
  full_name_en VARCHAR(200),
  photo VARCHAR(255),
  designation VARCHAR(150),
  department_id INTEGER REFERENCES hrm_departments(id) ON DELETE SET NULL,
  branch VARCHAR(150),
  phone VARCHAR(30),
  email VARCHAR(200),
  address TEXT,
  gender VARCHAR(10) CHECK (gender IN ('male','female','other')),
  dob DATE,
  citizenship_no VARCHAR(60),
  pan_no VARCHAR(30),
  join_date DATE,
  employment_type VARCHAR(20) NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent','contract','temporary','intern')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','resigned','retired','terminated')),
  exit_date DATE,
  basic_salary NUMERIC(14,2),
  bank_account VARCHAR(80),
  emergency_contact VARCHAR(200),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS hrm_employees_status_idx ON hrm_employees (status, department_id);

CREATE TABLE IF NOT EXISTS hrm_contracts (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
  contract_type VARCHAR(40) NOT NULL DEFAULT 'employment',
  start_date DATE NOT NULL,
  end_date DATE,
  salary NUMERIC(14,2),
  document VARCHAR(255),
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS hrm_contracts_end_idx ON hrm_contracts (end_date);

CREATE TABLE IF NOT EXISTS hrm_documents (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  doc_type VARCHAR(40) NOT NULL DEFAULT 'other',
  file_path VARCHAR(255) NOT NULL,
  expires_on DATE,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hrm_leaves (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(30) NOT NULL DEFAULT 'casual' CHECK (leave_type IN ('casual','sick','annual','maternity','paternity','mourning','unpaid','other')),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  days NUMERIC(5,1) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason TEXT,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (to_date >= from_date)
);

DROP TRIGGER IF EXISTS trg_touch_updated_at ON hrm_departments;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON hrm_departments FOR EACH ROW EXECUTE FUNCTION coop_touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_updated_at ON hrm_employees;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON hrm_employees FOR EACH ROW EXECUTE FUNCTION coop_touch_updated_at();
