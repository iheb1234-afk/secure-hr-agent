-- Migration 04: employee questions answered from company policies (run once in Supabase SQL Editor)

create table if not exists public.policy_sections (
  id uuid primary key default gen_random_uuid(),
  doc text not null,          -- policy document title
  section text not null,      -- section title
  content text not null,
  created_at timestamptz default now()
);

create table if not exists public.employee_questions (
  id uuid primary key default gen_random_uuid(),
  asked_by uuid references auth.users(id) default auth.uid(),
  question text not null,
  answer text,
  sources jsonb not null default '[]',
  status text not null check (status in ('answered','escalated','blocked')),
  reason text,
  created_at timestamptz default now()
);

alter table public.policy_sections enable row level security;
alter table public.employee_questions enable row level security;

drop policy if exists "policies_read" on public.policy_sections;
create policy "policies_read" on public.policy_sections for select to authenticated using (true);
drop policy if exists "policies_admin" on public.policy_sections;
create policy "policies_admin" on public.policy_sections for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- an employee sees their own questions; HR (recruiter/admin) sees all to handle escalations
drop policy if exists "questions_insert" on public.employee_questions;
create policy "questions_insert" on public.employee_questions for insert to authenticated with check (asked_by = auth.uid());
drop policy if exists "questions_read" on public.employee_questions;
create policy "questions_read" on public.employee_questions for select to authenticated
  using (asked_by = auth.uid() or public.my_role() in ('recruiter','admin'));
drop policy if exists "questions_update_hr" on public.employee_questions;
create policy "questions_update_hr" on public.employee_questions for update to authenticated
  using (public.my_role() in ('recruiter','admin'));

-- Fictional company handbook
delete from public.policy_sections;
insert into public.policy_sections (doc, section, content) values
('Leave policy','Annual leave','Every employee earns 2 working days of paid annual leave per month worked, i.e. 24 days per year. After 5 years of service, 1 extra day is added per 5 years, up to 30 days. Leave requests must be submitted at least 2 weeks in advance through HR and approved by the direct manager.'),
('Leave policy','Carry-over','Up to 6 unused annual leave days can be carried over to the next year. Carried-over days must be used before 31 March, otherwise they are lost. Leave cannot be paid out in cash except at the end of the contract.'),
('Leave policy','Sick leave','An employee who is sick must inform their manager before 10:00 on the first day and send a medical certificate within 48 hours. Sick leave is paid according to the social security rules; the company tops it up to full salary for the first 10 days per year.'),
('Leave policy','Special leave','Paid special leave: marriage of the employee 3 days, birth of a child 2 days for the father, death of a close family member 3 days, moving house 1 day. Maternity leave follows the labour code.'),
('Remote work policy','Eligibility and days','Employees who have completed their 3-month trial period can work remotely up to 2 days per week, agreed with their manager. Remote days cannot be on Monday for teams with a weekly meeting. Remote work from abroad is not allowed without written approval from HR.'),
('Remote work policy','Equipment','The company provides a laptop. A monthly internet allowance of 30 TND is paid to employees who work remotely at least 4 days per month.'),
('Working hours','Schedule','Standard working time is 40 hours per week, Monday to Friday, 8:30 to 17:30 with a 1-hour lunch break. During Ramadan, hours are 8:00 to 15:00. Overtime must be approved in advance by the manager and is paid at +25% for the first 8 hours per week and +50% beyond.'),
('Expenses policy','Business travel','Business travel must be approved before booking. Train or bus is preferred under 300 km. Meals are reimbursed up to 25 TND per meal with receipts. Expense reports must be submitted within 30 days with all receipts.'),
('Training policy','Training budget','Each employee has a training budget of 1,500 TND per year for courses or certifications linked to their job, approved by the manager. If the employee leaves within 12 months after a training paid over 1,000 TND, they reimburse 50% of its cost.'),
('Payroll','Payday and payslips','Salaries are paid on the 25th of each month by bank transfer. If the 25th is a weekend or holiday, payment is made the previous working day. Payslips are available in the HR portal. Changes of bank account must be sent to HR before the 15th.'),
('Code of conduct','Reporting a problem','Any harassment, discrimination or safety issue can be reported confidentially to HR or to the ethics committee at ethics@company-demo.tn. No employee can be punished for a report made in good faith.');
