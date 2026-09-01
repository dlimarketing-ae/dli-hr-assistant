-- Default settings. The admin password hash below decodes to "DLI@Admin123"
-- using PBKDF2-SHA256 (100,000 iterations) — see functions/api/_lib/auth.ts.
-- CHANGE THIS PASSWORD after your first login via the admin dashboard.
INSERT INTO settings (key, value) VALUES
  ('admin_password_hash', '22a6545308f1b8232537f8abaf9f9e63:bfcc25bf62ae6cd40c1296d91cbbbe9309d5a3c0d0b6fefa37312bcd81c5964b'),
  ('app_name', 'DLI HR Assistant'),
  ('app_icon', '🏢'),
  ('company_name', 'DLI')
ON CONFLICT(key) DO NOTHING;

-- Demo employees so you can try the app immediately after deploy.
-- Feel free to delete these from the admin dashboard once you upload real data.
INSERT INTO employees (employee_id, name, email, department, designation, join_date, annual_balance, sick_balance, casual_balance, unpaid_balance) VALUES
  ('DLI001', 'Amina Al Farsi', 'amina.alfarsi@dli.com', 'Human Resources', 'HR Manager', '2021-03-15', 21, 10, 7, 0),
  ('DLI002', 'Rohan Mehta', 'rohan.mehta@dli.com', 'Engineering', 'Software Engineer', '2022-07-01', 18, 8, 5, 0),
  ('DLI003', 'Sara Khalid', 'sara.khalid@dli.com', 'Finance', 'Accountant', '2020-01-10', 21, 10, 7, 0),
  ('DLI004', 'James O''Connor', 'james.oconnor@dli.com', 'Sales', 'Sales Executive', '2023-05-20', 15, 6, 4, 0),
  ('DLI005', 'Priya Nair', 'priya.nair@dli.com', 'Engineering', 'QA Lead', '2019-11-02', 21, 10, 7, 0)
ON CONFLICT(employee_id) DO NOTHING;
