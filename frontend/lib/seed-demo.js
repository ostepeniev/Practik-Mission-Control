/**
 * seed-demo.js — Demo data generation for Warehouse, HR, Finance modules
 * Called from db.js seedData() after core data is seeded.
 */

const fmt = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const daysAgo = (n) => new Date(today - n * 86400000);

function seedRng(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

function gaussRng(rng, mean, std) {
  const u1 = rng(), u2 = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function randInt(rng, a, b) { return Math.floor(rng() * (b - a + 1)) + a; }

// ─── WAREHOUSE SEED ─────────────────────────────────────────
export function seedWarehouse(db) {
  const rng = seedRng(100);
  const products = db.prepare('SELECT id, name, weight_kg, current_cost_price FROM core_products').all();
  const customers = db.prepare('SELECT id, name FROM core_customers').all();
  
  // Warehouse config
  db.exec(`INSERT INTO warehouse_config (name, capacity_kg) VALUES ('Склад Бровари', 50000), ('Склад Львів', 20000)`);

  // Lot batches — 60 batches over 90 days
  const insertBatch = db.prepare(`INSERT INTO lot_batches (product_id, batch_number, production_date, expiry_date, qty_produced_kg, qty_remaining_kg, warehouse) VALUES (?,?,?,?,?,?,?)`);
  const batches = [];
  for (let i = 0; i < 60; i++) {
    const prod = pick(rng, products.slice(0, 20)); // main products only
    const prodDate = fmt(daysAgo(randInt(rng, 5, 120)));
    const shelfDays = prod.weight_kg > 1 ? randInt(rng, 180, 365) : randInt(rng, 90, 180);
    const expiryDate = fmt(new Date(new Date(prodDate).getTime() + shelfDays * 86400000));
    const qtyProduced = Math.round(gaussRng(rng, 500, 200));
    const qtyRemaining = Math.max(0, Math.round(qtyProduced * rng() * 0.7));
    const wh = rng() < 0.7 ? 'Склад Бровари' : 'Склад Львів';
    const batchNum = `LOT-${String(i + 1).padStart(4, '0')}`;
    insertBatch.run(prod.id, batchNum, prodDate, expiryDate, qtyProduced, qtyRemaining, wh);
    batches.push({ id: i + 1, product_id: prod.id, batch_number: batchNum });
  }

  // Stock snapshots — 30 products × 90 days
  const insertSnapshot = db.prepare(`INSERT INTO stock_snapshots_daily (product_id, snapshot_date, qty_kg, qty_pcs, warehouse) VALUES (?,?,?,?,?)`);
  const stockProds = products.slice(0, 30);
  const seedSnaps = db.transaction(() => {
    for (const prod of stockProds) {
      let stockKg = Math.round(gaussRng(rng, 800, 300));
      for (let d = 90; d >= 0; d--) {
        const date = fmt(daysAgo(d));
        const dailySales = Math.round(gaussRng(rng, 15, 8));
        const replenish = rng() < 0.15 ? randInt(rng, 200, 600) : 0;
        stockKg = Math.max(0, stockKg - dailySales + replenish);
        const pcs = prod.weight_kg > 0.5 ? Math.round(stockKg / prod.weight_kg) : stockKg * 10;
        const wh = rng() < 0.7 ? 'Склад Бровари' : 'Склад Львів';
        insertSnapshot.run(prod.id, date, stockKg, pcs, wh);
      }
    }
  });
  seedSnaps();

  // Inventory movements — ~400 records
  const insertMovement = db.prepare(`INSERT INTO inventory_movements (product_id, movement_date, type, qty_kg, batch_id, source, warehouse) VALUES (?,?,?,?,?,?,?)`);
  const seedMov = db.transaction(() => {
    for (let d = 90; d >= 0; d--) {
      const date = fmt(daysAgo(d));
      const nMoves = randInt(rng, 2, 6);
      for (let m = 0; m < nMoves; m++) {
        const prod = pick(rng, stockProds);
        const type = rng() < 0.4 ? 'in' : 'out';
        const qty = type === 'in' ? randInt(rng, 100, 500) : randInt(rng, 5, 80);
        const batch = pick(rng, batches);
        const source = type === 'in' ? pick(rng, ['Виробництво', 'Постачальник', 'Трансфер']) : pick(rng, ['Замовлення', 'Повернення', 'Списання']);
        const wh = rng() < 0.7 ? 'Склад Бровари' : 'Склад Львів';
        insertMovement.run(prod.id, date, type, qty, batch.id, source, wh);
      }
    }
  });
  seedMov();

  // Warehouse orders — ~300 over 90 days
  const insertWhOrder = db.prepare(`INSERT INTO warehouse_orders (order_date, customer_id, status, total_weight_kg, items_count, ttn_cost, pick_time_min, warehouse) VALUES (?,?,?,?,?,?,?,?)`);
  const seedOrders = db.transaction(() => {
    for (let d = 90; d >= 0; d--) {
      const date = fmt(daysAgo(d));
      const dow = daysAgo(d).getDay();
      if (dow === 0 && rng() < 0.5) continue;
      const nOrders = randInt(rng, 1, 5);
      for (let o = 0; o < nOrders; o++) {
        const cust = pick(rng, customers);
        const weight = Math.round(gaussRng(rng, 120, 60));
        const items = randInt(rng, 1, 8);
        const ttnCost = Math.round(gaussRng(rng, 450, 150));
        const pickTime = Math.round(gaussRng(rng, 35, 15));
        const status = rng() < 0.9 ? 'completed' : (rng() < 0.5 ? 'pending' : 'cancelled');
        const wh = rng() < 0.7 ? 'Склад Бровари' : 'Склад Львів';
        insertWhOrder.run(date, cust.id, status, Math.max(10, weight), items, Math.max(100, ttnCost), Math.max(5, pickTime), wh);
      }
    }
  });
  seedOrders();
}

// ─── HR SEED ────────────────────────────────────────────────
export function seedHR(db) {
  const rng = seedRng(200);

  // Employees — 25 people
  const insertEmp = db.prepare(`INSERT INTO employees (name, department, position, hire_date, status, satisfaction_score, phone) VALUES (?,?,?,?,?,?,?)`);
  const hrEmployees = [
    ['Олена Бондаренко', 'Продажі', 'Менеджер з продажу', -400, 'active', 8.2],
    ['Максим Ткаченко', 'Продажі', 'Старший менеджер', -620, 'active', 7.5],
    ['Анна Шевченко', 'Продажі', 'Менеджер з продажу', -280, 'active', 8.8],
    ['Дмитро Мельник', 'Продажі', 'Менеджер з продажу', -510, 'active', 6.3],
    ['Ірина Кравченко', 'Маркетинг', 'Маркетолог', -350, 'active', 7.9],
    ['Сергій Козлов', 'Виробництво', 'Технолог', -700, 'active', 7.1],
    ['Наталія Лисенко', 'Виробництво', 'Оператор лінії', -450, 'active', 6.8],
    ['Олександр Попов', 'Виробництво', 'Оператор лінії', -320, 'active', 7.4],
    ['Марія Іванова', 'Виробництво', 'Контроль якості', -550, 'active', 8.0],
    ['Віктор Коваль', 'Склад', 'Комірник', -480, 'active', 6.5],
    ['Тетяна Морозова', 'Склад', 'Логіст', -380, 'active', 7.7],
    ['Андрій Савченко', 'Склад', 'Кранівник', -250, 'active', 7.0],
    ['Юлія Петренко', 'Бухгалтерія', 'Бухгалтер', -600, 'active', 8.1],
    ['Роман Гриценко', 'Бухгалтерія', 'Головний бухгалтер', -900, 'active', 7.6],
    ['Катерина Сидоренко', 'HR', 'HR менеджер', -400, 'active', 8.5],
    ['Павло Захарченко', 'Продажі', 'Менеджер з продажу', -150, 'active', 7.3],
    ['Інна Литвиненко', 'Продажі', 'Менеджер з продажу', -90, 'active', 6.9],
    ['Владислав Кузьменко', 'Виробництво', 'Механік', -530, 'active', 5.8],
    ['Оксана Руденко', 'Маркетинг', 'SMM менеджер', -200, 'active', 8.3],
    ['Артем Ніколаєв', 'Виробництво', 'Оператор лінії', -60, 'active', 7.2],
    ['Людмила Сорока', 'Продажі', 'Менеджер з продажу', -45, 'active', 7.8],
    ['Ігор Ярошенко', 'Склад', 'Комірник', -30, 'active', 6.7],
    ['Валентина Бойко', 'Бухгалтерія', 'Касир', -500, 'fired', 5.2],
    ['Михайло Тимошенко', 'Виробництво', 'Оператор лінії', -400, 'fired', 4.5],
    ['Олег Панасюк', 'Склад', 'Вантажник', -350, 'fired', 4.8],
  ];

  for (const [name, dept, pos, hireDaysAgo, status, score] of hrEmployees) {
    const phone = `+380${randInt(rng, 50, 99)}${randInt(rng, 1000000, 9999999)}`;
    insertEmp.run(name, dept, pos, fmt(daysAgo(Math.abs(hireDaysAgo))), status, score, phone);
  }

  // Employee calls — ~400 over 90 days
  const insertCall = db.prepare(`INSERT INTO employee_calls (employee_id, call_date, call_time, duration_sec, client_name, direction, call_type) VALUES (?,?,?,?,?,?,?)`);
  const insertSentiment = db.prepare(`INSERT INTO call_sentiment_scores (call_id, sentiment, score, has_conflict, ai_summary) VALUES (?,?,?,?,?)`);
  const insertConflict = db.prepare(`INSERT INTO employee_conflict_events (employee_id, call_id, conflict_date, severity, description, resolution) VALUES (?,?,?,?,?,?)`);
  
  const clientNames = ['ТОВ ЗооМаркет Плюс', 'Мережа PetCity', 'ВауПет Онлайн', 'Розетка Маркет', 'Happy Paw', 'MasterZoo', 'ФОП Петренко', 'ЗооЛабіринт', 'Zoolux', 'Тваринний світ', 'АгроЗоо', 'ФОП Коваленко', 'Клієнт (вхідний)', 'Постачальник'];
  const conflictDescs = [
    'Клієнт скаржиться на затримку доставки', 'Конфлікт щодо якості товару',
    'Суперечка по ціні та знижках', 'Невдоволення умовами повернення',
    'Грубий тон у розмові з клієнтом', 'Клієнт вимагає компенсацію',
    'Непорозуміння щодо асортименту', 'Скарга на менеджера від клієнта',
  ];

  const activeEmployees = [1,2,3,4,5,6,9,10,11,15,16,17,19,21]; // sales/warehouse/marketing related
  
  const seedCalls = db.transaction(() => {
    let callId = 0;
    for (let d = 90; d >= 0; d--) {
      const date = fmt(daysAgo(d));
      const dow = daysAgo(d).getDay();
      if (dow === 0) continue;
      
      const nCalls = randInt(rng, 3, 7);
      for (let c = 0; c < nCalls; c++) {
        const empId = pick(rng, activeEmployees);
        const hour = randInt(rng, 8, 18);
        const min = randInt(rng, 0, 59);
        const time = `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
        const duration = randInt(rng, 30, 900);
        const client = pick(rng, clientNames);
        const direction = rng() < 0.6 ? 'outbound' : 'inbound';
        const callType = rng() < 0.7 ? 'sales' : (rng() < 0.5 ? 'support' : 'follow-up');
        
        const res = insertCall.run(empId, date, time, duration, client, direction, callType);
        callId = Number(res.lastInsertRowid);

        // Sentiment
        const baseScore = hrEmployees[empId - 1]?.[5] || 7;
        let score = Math.min(10, Math.max(1, Math.round(gaussRng(rng, baseScore, 1.5))));
        const hasConflict = score <= 3 ? 1 : (score <= 5 && rng() < 0.15 ? 1 : 0);
        const sentiment = score >= 7 ? 'positive' : (score >= 4 ? 'neutral' : 'negative');
        const summaries = {
          positive: ['Конструктивна розмова', 'Клієнт задоволений', 'Успішне закриття угоди', 'Дружній тон'],
          neutral: ['Стандартний дзвінок', 'Обговорення деталей замовлення', 'Уточнення інформації'],
          negative: ['Клієнт незадоволений', 'Напружений тон', 'Скарга клієнта', 'Конфліктна ситуація'],
        };
        insertSentiment.run(callId, sentiment, score, hasConflict, pick(rng, summaries[sentiment]));

        // Conflict events
        if (hasConflict) {
          const sev = score <= 2 ? 'critical' : 'warning';
          insertConflict.run(empId, callId, date, sev, pick(rng, conflictDescs), rng() < 0.6 ? 'Вирішено' : 'В процесі');
        }
      }
    }
  });
  seedCalls();

  // Weekly sentiment aggregates
  const insertWeekly = db.prepare(`INSERT INTO employee_sentiment_weekly (employee_id, week_start, avg_score, call_count, conflict_count, trend) VALUES (?,?,?,?,?,?)`);
  const seedWeekly = db.transaction(() => {
    for (let empId = 1; empId <= 25; empId++) {
      let prevScore = null;
      for (let w = 12; w >= 0; w--) {
        const weekStart = fmt(daysAgo(w * 7));
        const calls = db.prepare(
          `SELECT AVG(s.score) as avg, COUNT(*) as cnt, SUM(s.has_conflict) as conflicts
           FROM employee_calls c JOIN call_sentiment_scores s ON s.call_id = c.id
           WHERE c.employee_id = ? AND c.call_date >= ? AND c.call_date < ?`
        ).get(empId, weekStart, fmt(daysAgo((w - 1) * 7)));
        
        const avg = calls?.avg || gaussRng(rng, 7, 1.5);
        const cnt = calls?.cnt || 0;
        const conflicts = calls?.conflicts || 0;
        const trend = prevScore === null ? 'stable' : (avg > prevScore + 0.3 ? 'improving' : (avg < prevScore - 0.3 ? 'declining' : 'stable'));
        prevScore = avg;
        insertWeekly.run(empId, weekStart, Math.round(avg * 10) / 10, cnt, conflicts, trend);
      }
    }
  });
  seedWeekly();
}

// ─── FINANCE SEED ───────────────────────────────────────────
export function seedFinance(db) {
  const rng = seedRng(300);
  const customers = db.prepare('SELECT id, name FROM core_customers').all();

  // Receivables — 40 records
  const insertReceivable = db.prepare(`INSERT INTO receivables (customer_id, invoice_number, invoice_date, due_date, amount, paid_amount, status, days_overdue) VALUES (?,?,?,?,?,?,?,?)`);
  const seedRecv = db.transaction(() => {
    for (let i = 0; i < 40; i++) {
      const cust = pick(rng, customers);
      const invDate = fmt(daysAgo(randInt(rng, 5, 90)));
      const dueDays = pick(rng, [7, 14, 30, 45]);
      const dueDate = fmt(new Date(new Date(invDate).getTime() + dueDays * 86400000));
      const amount = Math.round(gaussRng(rng, 45000, 25000));
      const paidPct = rng() < 0.4 ? 1.0 : (rng() < 0.3 ? 0 : rng() * 0.8);
      const paid = Math.round(amount * paidPct);
      const overdue = Math.max(0, Math.round((today - new Date(dueDate)) / 86400000));
      const status = paid >= amount ? 'paid' : (overdue > 0 ? 'overdue' : 'pending');
      insertReceivable.run(cust.id, `INV-${2024000 + i}`, invDate, dueDate, Math.max(5000, amount), paid, status, status === 'paid' ? 0 : overdue);
    }
  });
  seedRecv();

  // Payables — 25 records
  const suppliers = ['ТОВ МʼясоПром', 'ФОП Зернотрейд', 'АгроСоюз', 'ТОВ Упаковка+', 'ЛогістикЮА', 'ТОВ ВетФарм', 'ФОП Хімпостач', 'ТОВ ПакМастер'];
  const insertPayable = db.prepare(`INSERT INTO payables (supplier_name, invoice_date, due_date, amount, paid_amount, category, status) VALUES (?,?,?,?,?,?,?)`);
  const seedPay = db.transaction(() => {
    for (let i = 0; i < 25; i++) {
      const supplier = pick(rng, suppliers);
      const invDate = fmt(daysAgo(randInt(rng, 3, 60)));
      const dueDate = fmt(new Date(new Date(invDate).getTime() + 30 * 86400000));
      const amount = Math.round(gaussRng(rng, 80000, 40000));
      const paidPct = rng() < 0.5 ? 1.0 : (rng() < 0.3 ? 0 : rng() * 0.7);
      const paid = Math.round(amount * paidPct);
      const status = paid >= amount ? 'paid' : 'pending';
      const cat = pick(rng, ['Сировина', 'Пакування', 'Логістика', 'Обладнання', 'Ветпрепарати']);
      insertPayable.run(supplier, invDate, dueDate, Math.max(10000, amount), paid, cat, status);
    }
  });
  seedPay();

  // Expenses — 200 records over 90 days
  const insertExpense = db.prepare(`INSERT INTO expenses (expense_date, category, subcategory, amount, description, is_fixed) VALUES (?,?,?,?,?,?)`);
  const expenseTypes = [
    { cat: 'Зарплати', sub: 'Виробництво', min: 8000, max: 15000, fixed: 1 },
    { cat: 'Зарплати', sub: 'Офіс', min: 6000, max: 12000, fixed: 1 },
    { cat: 'Зарплати', sub: 'Склад', min: 5000, max: 10000, fixed: 1 },
    { cat: 'Оренда', sub: 'Виробництво', min: 30000, max: 50000, fixed: 1 },
    { cat: 'Оренда', sub: 'Офіс', min: 15000, max: 25000, fixed: 1 },
    { cat: 'Логістика', sub: 'Доставка', min: 2000, max: 8000, fixed: 0 },
    { cat: 'Маркетинг', sub: 'Реклама', min: 3000, max: 15000, fixed: 0 },
    { cat: 'Маркетинг', sub: 'SMM', min: 1000, max: 5000, fixed: 0 },
    { cat: 'Комунальні', sub: 'Електрика', min: 5000, max: 12000, fixed: 0 },
    { cat: 'Комунальні', sub: 'Вода/газ', min: 2000, max: 6000, fixed: 0 },
    { cat: 'Сировина', sub: 'Мʼясо', min: 20000, max: 80000, fixed: 0 },
    { cat: 'Сировина', sub: 'Добавки', min: 5000, max: 20000, fixed: 0 },
    { cat: 'Пакування', sub: 'Упаковка', min: 3000, max: 12000, fixed: 0 },
    { cat: 'Інше', sub: 'Канцтовари', min: 500, max: 2000, fixed: 0 },
  ];
  const seedExp = db.transaction(() => {
    for (let d = 90; d >= 0; d--) {
      const date = fmt(daysAgo(d));
      const dow = daysAgo(d).getDay();
      if (dow === 0 || dow === 6) continue;
      const nExpenses = randInt(rng, 1, 4);
      for (let e = 0; e < nExpenses; e++) {
        const type = pick(rng, expenseTypes);
        const amount = randInt(rng, type.min, type.max);
        insertExpense.run(date, type.cat, type.sub, amount, `${type.cat}: ${type.sub}`, type.fixed);
      }
    }
  });
  seedExp();

  // Cashflow events — derive from sales + expenses
  const insertCashflow = db.prepare(`INSERT INTO cashflow_events (event_date, type, amount, category, description) VALUES (?,?,?,?,?)`);
  const seedCF = db.transaction(() => {
    for (let d = 90; d >= 0; d--) {
      const date = fmt(daysAgo(d));
      // Income from sales
      const salesRow = db.prepare(`SELECT SUM(total_amount) as total FROM core_sales_orders WHERE order_date = ? AND payment_status = 'paid'`).get(date);
      if (salesRow?.total) {
        insertCashflow.run(date, 'income', salesRow.total, 'Продажі', 'Оплати від клієнтів');
      }
      // Random additional income
      if (rng() < 0.1) {
        insertCashflow.run(date, 'income', randInt(rng, 5000, 30000), 'Інше', pick(rng, ['Повернення переплати', 'Курсова різниця', 'Субсидія']));
      }
      // Expenses
      const expRows = db.prepare(`SELECT SUM(amount) as total, category FROM expenses WHERE expense_date = ? GROUP BY category`).all(date);
      for (const exp of expRows) {
        insertCashflow.run(date, 'expense', exp.total, exp.category, `Витрати: ${exp.category}`);
      }
    }
  });
  seedCF();

  // Purchase price history — 10 materials × 10 dates
  const insertPP = db.prepare(`INSERT INTO purchase_price_history (material_name, effective_date, price_per_kg, supplier, market_avg_price) VALUES (?,?,?,?,?)`);
  const materials = [
    { name: 'Яловичина (свіжа)', base: 180, supplier: 'ТОВ МʼясоПром' },
    { name: 'Індичка (свіжа)', base: 160, supplier: 'ТОВ МʼясоПром' },
    { name: 'Качка (свіжа)', base: 200, supplier: 'ТОВ МʼясоПром' },
    { name: 'Лосось (свіжий)', base: 350, supplier: 'ФОП Рибтрейд' },
    { name: 'Рис', base: 35, supplier: 'ФОП Зернотрейд' },
    { name: 'Батат', base: 45, supplier: 'АгроСоюз' },
    { name: 'Криль', base: 800, supplier: 'ФОП Рибтрейд' },
    { name: 'Печінка (яловича)', base: 120, supplier: 'ТОВ МʼясоПром' },
    { name: 'Курка (свіжа)', base: 95, supplier: 'ТОВ МʼясоПром' },
    { name: 'Телятина (свіжа)', base: 210, supplier: 'ТОВ МʼясоПром' },
  ];
  const seedPP = db.transaction(() => {
    for (const mat of materials) {
      for (let m = 6; m >= 0; m--) {
        const date = fmt(daysAgo(m * 15));
        const fluctuation = 1 + (rng() - 0.5) * 0.2;
        const price = Math.round(mat.base * fluctuation);
        const marketAvg = Math.round(mat.base * (1 + (rng() - 0.5) * 0.15));
        insertPP.run(mat.name, date, price, mat.supplier, marketAvg);
      }
    }
  });
  seedPP();
}
