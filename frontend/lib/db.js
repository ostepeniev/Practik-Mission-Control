import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

const DB_PATH = path.join(process.cwd(), 'practik.db');
let _db = null;
let _checkpointInterval = null;

export function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initDb(_db);
    runMigrations(_db);

    // Periodic WAL checkpoint — merge WAL into main .db every 30 min
    if (!_checkpointInterval) {
      _checkpointInterval = setInterval(() => {
        try { _db?.pragma('wal_checkpoint(TRUNCATE)'); }
        catch (e) { /* ignore if db is busy */ }
      }, 30 * 60 * 1000);
      // Don't block Node.js from exiting
      if (_checkpointInterval.unref) _checkpointInterval.unref();
    }
  }
  return _db;
}

function initDb(db) {
  // Check if already initialized
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_users'").get();
  if (exists) return;

  // Create tables
  db.exec(`
    -- Core reference tables
    CREATE TABLE IF NOT EXISTS core_product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES core_product_categories(id)
    );

    CREATE TABLE IF NOT EXISTS core_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES core_product_categories(id),
      sku TEXT UNIQUE NOT NULL,
      brand TEXT DEFAULT 'Practik',
      weight_kg REAL,
      launch_date TEXT,
      status TEXT DEFAULT 'active',
      target_margin_pct REAL DEFAULT 30.0,
      current_cost_price REAL,
      recommended_sale_price REAL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS core_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      region TEXT,
      channel TEXT,
      customer_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS core_managers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT,
      is_active INTEGER DEFAULT 1
    );

    -- Operational facts
    CREATE TABLE IF NOT EXISTS core_sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      order_date TEXT NOT NULL,
      customer_id INTEGER REFERENCES core_customers(id),
      manager_id INTEGER REFERENCES core_managers(id),
      channel TEXT,
      status TEXT DEFAULT 'completed',
      payment_status TEXT DEFAULT 'paid',
      shipping_status TEXT DEFAULT 'shipped',
      total_amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS core_sales_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES core_sales_orders(id),
      product_id INTEGER NOT NULL REFERENCES core_products(id),
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount_pct REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      final_price REAL NOT NULL,
      cost_price_at_sale REAL,
      is_promo INTEGER DEFAULT 0,
      promo_type TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS core_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_item_id INTEGER NOT NULL REFERENCES core_sales_order_items(id),
      return_date TEXT NOT NULL,
      quantity REAL NOT NULL,
      reason TEXT,
      return_type TEXT DEFAULT 'return',
      amount REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS core_cost_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES core_products(id),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      cost_price REAL NOT NULL,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Complaints
    CREATE TABLE IF NOT EXISTS core_complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES core_products(id),
      complaint_date TEXT NOT NULL,
      batch_number TEXT,
      source TEXT DEFAULT 'клієнт',
      description TEXT NOT NULL,
      status TEXT DEFAULT 'new',
      severity TEXT DEFAULT 'medium',
      resolution TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- App tables
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'owner',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_dashboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS app_dashboard_tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dashboard_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS app_widgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id INTEGER NOT NULL,
      widget_type TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      data_source TEXT NOT NULL,
      config_json TEXT,
      size TEXT DEFAULT 'md',
      sort_order INTEGER DEFAULT 0,
      is_visible_owner INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      row_num INTEGER DEFAULT 0,
      col_num INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_feature_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_key TEXT UNIQUE NOT NULL,
      is_enabled INTEGER DEFAULT 0,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS app_metric_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      name_ua TEXT,
      description TEXT,
      formula TEXT,
      unit TEXT,
      grain TEXT,
      category TEXT,
      owner TEXT,
      refresh_interval_min INTEGER DEFAULT 15
    );

    -- AI tables
    CREATE TABLE IF NOT EXISTS ai_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      input_summary TEXT,
      output_summary TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      insight_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      related_product_id INTEGER,
      related_metric TEXT,
      confidence REAL,
      is_read INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_provider_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      api_key_env TEXT NOT NULL,
      model_name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 10,
      max_tokens INTEGER DEFAULT 2000,
      temperature REAL DEFAULT 0.3
    );

    -- Audit
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- AI Conversations (server-side memory)
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT DEFAULT 'Новий діалог',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_tool_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER,
      conversation_id INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_orders_date ON core_sales_orders(order_date);
    CREATE INDEX IF NOT EXISTS idx_items_order ON core_sales_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_items_product ON core_sales_order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON core_products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_sku ON core_products(sku);
    CREATE INDEX IF NOT EXISTS idx_complaints_date ON core_complaints(complaint_date);
    CREATE INDEX IF NOT EXISTS idx_complaints_product ON core_complaints(product_id);
    CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_ai_tools_conv ON ai_tool_logs(conversation_id);

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL DEFAULT 'alert',
      severity TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      source TEXT DEFAULT 'system',
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notif_date ON notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);
  `);

  // Seed data
  seedData(db);
}

function seedData(db) {
  const insertCategory = db.prepare('INSERT INTO core_product_categories (id, name) VALUES (?, ?)');
  const categories = [
    [1, 'Practik Fresh — Собаки'],
    [2, 'Practik Fresh — Коти'],
    [3, 'Practik Simple — Собаки'],
    [4, 'Practik Simple — Коти'],
    [5, 'Practik Daily — Собаки'],
    [6, 'Practik Daily — Коти'],
    [7, 'Practik Смаколик'],
    [8, 'Practik SuperFood'],
    [9, 'Practik Box'],
  ];
  for (const c of categories) insertCategory.run(...c);

  // Real products from practik.ua — prices per displayed weight variant
  const insertProduct = db.prepare(`INSERT INTO core_products (name, category_id, sku, weight_kg, launch_date, status, target_margin_pct, current_cost_price, recommended_sale_price, brand) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(today - n * 86400000);
  const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

  // [name, catId, sku, weightKg, costPrice, salePrice, targetMargin, brand]
  // Cost prices estimated as ~55-65% of sale price (realistic manufacturing margins)
  const products = [
    // ─── Practik Fresh (холістик, преміум лінійка) ───────
    ['Їжа для собак «4 протеїни» Fresh (сер./великі)', 1, 'FRESH-DOG-4P-8', 8, 1115, 1856, 40, 'Practik Fresh'],
    ['Їжа для собак «4 протеїни» Fresh (малі)', 1, 'FRESH-DOG-4P-SM-3', 3, 545, 909, 40, 'Practik Fresh'],
    ['Їжа для котів та кошенят «4 протеїни» Fresh', 2, 'FRESH-CAT-4P-3', 3, 572, 954, 40, 'Practik Fresh'],

    // ─── Practik Simple (супер-преміум) ──────────────────
    ['Їжа для собак «Качка з суперфудами» Simple', 3, 'SMPL-DOG-DK-10', 10, 1182, 1970, 40, 'Practik Simple'],
    ['Їжа для собак «Ягня з суперфудами» Simple', 3, 'SMPL-DOG-LM-10', 10, 1254, 2090, 40, 'Practik Simple'],
    ['Їжа для собак «Свіжа яловичина» Simple', 3, 'SMPL-DOG-BF-10', 10, 834, 1390, 40, 'Practik Simple'],
    ['Їжа для собак «Свіжа індичка» Simple', 3, 'SMPL-DOG-TK-10', 10, 828, 1380, 40, 'Practik Simple'],
    ['Їжа для собак «Свіжий лосось» Simple', 3, 'SMPL-DOG-SL-10', 10, 1134, 1890, 40, 'Practik Simple'],
    ['Їжа для собак малих порід «Свіжа індичка» Simple', 3, 'SMPL-DOG-TK-SM-5', 5, 480, 800, 40, 'Practik Simple'],
    ['Їжа для котів «Свіжа яловичина» Simple', 4, 'SMPL-CAT-BF-5', 5, 540, 900, 40, 'Practik Simple'],
    ['Їжа для котів «Свіжий лосось» Simple', 4, 'SMPL-CAT-SL-5', 5, 708, 1180, 40, 'Practik Simple'],
    ['Їжа для котів «Свіжа індичка» Simple', 4, 'SMPL-CAT-TK-5', 5, 570, 950, 40, 'Practik Simple'],

    // ─── Practik Daily (преміум, найдоступніша) ──────────
    ['Їжа для собак малих порід «Свіжа телятина» Daily', 5, 'DAIL-DOG-VL-SM-5', 5, 380, 690, 45, 'Practik Daily'],
    ['Їжа для собак «Свіжа телятина» Daily', 5, 'DAIL-DOG-VL-10', 10, 506, 920, 45, 'Practik Daily'],
    ['Їжа для собак «Свіжа курка» Daily', 5, 'DAIL-DOG-CH-10', 10, 495, 900, 45, 'Practik Daily'],
    ['Їжа для котів «Свіжа телятина» Daily', 6, 'DAIL-CAT-VL-5', 5, 360, 655, 45, 'Practik Daily'],
    ['Їжа для котів «Свіжа курка» Daily', 6, 'DAIL-CAT-CH-5', 5, 355, 645, 45, 'Practik Daily'],

    // ─── Practik Смаколик — Печиво ──────────────────────
    ['Печиво «Качка-яблуко» Смаколик (3 шт)', 7, 'SMAK-PCH-DK-3', 0.12, 50, 93, 46, 'Practik Смаколик'],
    ['Печиво «Індичка-батат» Смаколик (3 шт)', 7, 'SMAK-PCH-TK-3', 0.12, 48, 90, 47, 'Practik Смаколик'],
    ['Печиво «Лосось-амарант» Смаколик (3 шт)', 7, 'SMAK-PCH-SL-3', 0.12, 50, 93, 46, 'Practik Смаколик'],

    // ─── Practik Смаколик — М'які ───────────────────────
    ['Медальйони з качкою Смаколик (80 г)', 7, 'SMAK-MDL-DK-80', 0.08, 85, 169, 50, 'Practik Смаколик'],
    ['Шматочки з печінкою Смаколик (80 г)', 7, 'SMAK-SHM-PCH-80', 0.08, 88, 175, 50, 'Practik Смаколик'],
    ['Палички з качкою Смаколик (80 г)', 7, 'SMAK-PAL-DK-80', 0.08, 90, 179, 50, 'Practik Смаколик'],
    ['Смужки з креветкою Смаколик (80 г)', 7, 'SMAK-SMU-KR-80', 0.08, 83, 165, 50, 'Practik Смаколик'],
    ['Палички з печінкою Смаколик (80 г)', 7, 'SMAK-PAL-PCH-80', 0.08, 78, 155, 50, 'Practik Смаколик'],
    ['Медальйони з яловичиною Смаколик (80 г)', 7, 'SMAK-MDL-BF-80', 0.08, 85, 169, 50, 'Practik Смаколик'],

    // ─── Practik Смаколик — Сушеності ───────────────────
    ['Вуха кролика з хутром Смаколик (50 г)', 7, 'SMAK-VKRL-50', 0.05, 83, 165, 50, 'Practik Смаколик'],
    ['Легені шматочками Practik (150 г)', 7, 'SMAK-LEG-SHM-150', 0.15, 101, 201, 50, 'Practik Смаколик'],
    ['Легені слайсами Practik (100 г)', 7, 'SMAK-LEG-SL-100', 0.1, 77, 153, 50, 'Practik Смаколик'],
    ['М\'ясне асорті (150 г)', 7, 'SMAK-ASRT-150', 0.15, 93, 186, 50, 'Practik Смаколик'],
    ['М\'ясне асорті mini (100 г)', 7, 'SMAK-ASRT-MINI-100', 0.1, 64, 128, 50, 'Practik Смаколик'],
    ['Рубець шматочками Practik (150 г)', 7, 'SMAK-RUB-SHM-150', 0.15, 90, 179, 50, 'Practik Смаколик'],

    // ─── Practik SuperFood ──────────────────────────────
    ['Топер «Апетитна печінка 100%» SuperFood', 8, 'SFOOD-TOP-PCH', 0.15, 130, 257, 49, 'Practik SuperFood'],
    ['Апетайзер «Легені 100%» SuperFood (150 г)', 8, 'SFOOD-APT-LEG-150', 0.15, 127, 252, 50, 'Practik SuperFood'],
    ['Протеїнове борошно «Криль 100%» SuperFood (200 г)', 8, 'SFOOD-PB-KRL-200', 0.2, 143, 284, 50, 'Practik SuperFood'],
    ['Протеїнове борошно «Індичка 100%» SuperFood (350 г)', 8, 'SFOOD-PB-TK-350', 0.35, 142, 284, 50, 'Practik SuperFood'],

    // ─── Practik Box ────────────────────────────────────
    ['Practik Box для собак сер./великих порід', 9, 'BOX-DOG-ML', 1.5, 250, 459, 45, 'Practik Box'],
    ['Practik Box для собак малих порід', 9, 'BOX-DOG-SM', 1.5, 250, 459, 45, 'Practik Box'],
    ['Practik Box для цуценят', 9, 'BOX-PUPPY', 1.0, 220, 399, 45, 'Practik Box'],
    ['Practik Box для котів', 9, 'BOX-CAT', 1.0, 220, 399, 45, 'Practik Box'],
    ['Practik Box для кошенят', 9, 'BOX-KITTEN', 0.8, 200, 359, 44, 'Practik Box'],
  ];

  for (let i = 0; i < products.length; i++) {
    const [name, catId, sku, weight, cost, price, margin, brand] = products[i];
    const isNew = i >= products.length - 7;
    const launch = fmt(daysAgo(isNew ? randInt(3, 15) : randInt(60, 400)));
    const status = isNew ? 'new' : 'active';
    insertProduct.run(name, catId, sku, weight, launch, status, margin, cost, price, brand);
  }

  // Customers
  const insertCustomer = db.prepare('INSERT INTO core_customers (name, region, channel, customer_type) VALUES (?,?,?,?)');
  const customers = [
    ['ТОВ ЗооМаркет Плюс', 'Київ', 'wholesale', 'b2b'],
    ['ФОП Петренко О.В.', 'Львів', 'wholesale', 'b2b'],
    ['Мережа PetCity', 'Харків', 'retail', 'b2b'],
    ['Тваринний світ', 'Одеса', 'retail', 'b2b'],
    ['ВауПет Онлайн', 'Київ', 'online', 'b2b'],
    ['Розетка Маркет', 'Київ', 'marketplace', 'b2b'],
    ['Prom.ua Зоотовари', 'Київ', 'marketplace', 'b2b'],
    ['ЗооЛабіринт', 'Дніпро', 'retail', 'b2b'],
    ['ФОП Коваленко І.М.', 'Вінниця', 'wholesale', 'b2b'],
    ['Happy Paw Мережа', 'Запоріжжя', 'retail', 'b2b'],
    ['ТОВ АгроЗоо', 'Полтава', 'wholesale', 'b2b'],
    ['MasterZoo Мережа', 'Київ', 'retail', 'b2b'],
    ['Zoolux Онлайн', 'Одеса', 'online', 'b2b'],
    ['ФОП Сидоренко А.П.', 'Чернігів', 'wholesale', 'b2b'],
    ['ZooUkraine', 'Львів', 'marketplace', 'b2b'],
  ];
  for (const c of customers) insertCustomer.run(...c);

  // Managers
  const insertManager = db.prepare('INSERT INTO core_managers (name, department) VALUES (?,?)');
  const managers = [
    ['Олена Бондаренко', 'Продажі'], ['Максим Ткаченко', 'Продажі'],
    ['Анна Шевченко', 'Продажі'], ['Дмитро Мельник', 'Продажі'],
    ['Ірина Кравченко', 'Маркетинг'],
  ];
  for (const m of managers) insertManager.run(...m);

  // Users
  const insertUser = db.prepare('INSERT INTO app_users (username, password_hash, display_name, role) VALUES (?,?,?,?)');
  insertUser.run('admin', bcrypt.hashSync('Alisio777', 10), 'Адміністратор', 'developer');
  insertUser.run('Ivan', bcrypt.hashSync('kjsd7dh', 10), 'Іван (Власник)', 'owner');

  // Generate 90 days of sales
  const allProducts = db.prepare('SELECT * FROM core_products').all();
  const insertOrder = db.prepare('INSERT INTO core_sales_orders (order_number, order_date, customer_id, manager_id, channel, status, payment_status, shipping_status, total_amount) VALUES (?,?,?,?,?,?,?,?,?)');
  const insertItem = db.prepare('INSERT INTO core_sales_order_items (order_id, product_id, quantity, unit_price, discount_pct, discount_amount, final_price, cost_price_at_sale, is_promo, promo_type) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insertReturn = db.prepare('INSERT INTO core_returns (order_item_id, return_date, quantity, reason, return_type, amount) VALUES (?,?,?,?,?,?)');

  // Seed with transaction for speed
  const seedSales = db.transaction(() => {
    let orderNum = 10000;
    const rng = seedRandom(42);

    for (let dayOff = 90; dayOff >= 0; dayOff--) {
      const orderDate = fmt(daysAgo(dayOff));
      const dow = daysAgo(dayOff).getDay();

      if (dow === 0 && rng() < 0.4) continue;

      let dayMult = 1.0;
      if (dow === 1 || dow === 5) dayMult = 1.3;
      if (dow === 0) dayMult = 0.5;

      let nOrders = Math.round(gaussRng(rng, 12, 4) * dayMult);
      nOrders = Math.max(3, Math.min(25, nOrders));

      for (let o = 0; o < nOrders; o++) {
        orderNum++;
        const custId = Math.floor(rng() * 15) + 1;
        const mgrId = Math.floor(rng() * 4) + 1;
        const cust = customers[custId - 1];

        const status = rng() < 0.92 ? 'completed' : (rng() < 0.5 ? 'pending' : 'cancelled');
        const payStatus = rng() < 0.85 ? 'paid' : (['pending', 'partial', 'overdue'])[Math.floor(rng() * 3)];
        const shipStatus = rng() < 0.88 ? 'delivered' : (rng() < 0.5 ? 'pending' : 'shipped');

        const ordResult = insertOrder.run(`ORD-${orderNum}`, orderDate, custId, mgrId, cust?.[2] || 'online', status, payStatus, shipStatus, 0);
        const orderId = ordResult.lastInsertRowid;

        const nItems = [1,2,3,4,5][weightedChoice(rng, [30,35,20,10,5])];
        const chosenIds = new Set();
        let orderTotal = 0;

        for (let it = 0; it < nItems; it++) {
          const prodIdx = weightedProductChoice(rng, allProducts);
          const prod = allProducts[prodIdx];
          if (chosenIds.has(prod.id)) continue;
          chosenIds.add(prod.id);

          const qty = [1,2,3,5,10,20][weightedChoice(rng, [20,30,20,15,10,5])];
          let unitPrice = prod.recommended_sale_price * (0.92 + rng() * 0.16);
          unitPrice = Math.round(unitPrice * 100) / 100;

          let discountPct = 0, isPromo = 0, promoType = null;
          const roll = rng();
          if (roll < 0.03) {
            discountPct = [50, 80, 100][Math.floor(rng() * 3)];
            isPromo = 1;
            promoType = ['blogger', 'gift', 'sample', 'marketing'][Math.floor(rng() * 4)];
          } else if (roll < 0.08) {
            discountPct = 15 + rng() * 15;
          } else if (roll < 0.25) {
            discountPct = 3 + rng() * 9;
          }

          const discAmount = Math.round(unitPrice * qty * discountPct / 100 * 100) / 100;
          const finalPrice = Math.max(Math.round((unitPrice * qty - discAmount) * 100) / 100, 0);
          const costAtSale = Math.round(prod.current_cost_price * (0.97 + rng() * 0.06) * 100) / 100;

          const itemResult = insertItem.run(orderId, prod.id, qty, unitPrice, Math.round(discountPct * 10) / 10, discAmount, finalPrice, costAtSale, isPromo, promoType);
          orderTotal += finalPrice;

          // 2% returns
          if (rng() < 0.02 && status === 'completed') {
            const retDate = fmt(new Date(daysAgo(dayOff).getTime() + randInt(1, 14) * 86400000));
            const reasons = ['Пошкоджена упаковка', 'Невідповідність замовленню', 'Тварина не їсть', 'Прострочений термін', 'Зміна рішення клієнтом'];
            insertReturn.run(itemResult.lastInsertRowid, retDate, Math.min(qty, randInt(1, 2)), reasons[Math.floor(rng() * reasons.length)], ['return', 'complaint', 'compensation'][Math.floor(rng() * 3)], Math.round(finalPrice * (rng() < 0.5 ? 0.5 : 1) * 100) / 100);
          }
        }

        db.prepare('UPDATE core_sales_orders SET total_amount = ? WHERE id = ?').run(Math.round(orderTotal * 100) / 100, orderId);
      }
    }
  });
  seedSales();

  // Feature flags
  const insertFlag = db.prepare('INSERT INTO app_feature_flags (feature_key, is_enabled, description) VALUES (?,?,?)');
  insertFlag.run('ai_insights', 1, 'AI інсайти на дашборді');
  insertFlag.run('ai_chat', 1, 'AI чат для запитів');
  insertFlag.run('product_detail', 1, 'Детальна сторінка товару');
  insertFlag.run('anomaly_detection', 1, 'Автоматичне виявлення аномалій');
  insertFlag.run('export_csv', 0, 'Експорт в CSV (в розробці)');
  insertFlag.run('forecast', 0, 'Прогнозування продажів (Phase 2)');

  // AI Insights
  const insertInsight = db.prepare('INSERT INTO ai_insights (insight_type, severity, title, body, related_product_id, related_metric, confidence) VALUES (?,?,?,?,?,?,?)');
  insertInsight.run('anomaly', 'warning', 'Різке падіння маржі по Simple Яловичина', 'Маржинальність по товару SMPL-DOG-BF-10 «Свіжа яловичина» впала з 40% до 24% за останні 3 дні. Основна причина — зростання кількості замовлень зі знижкою >15%. 4 замовлення мають нетипову знижку 25-30%. Рекомендація: перевірити, чи санкціоновані ці знижки менеджерами.', 6, 'gross_margin_pct', 0.82);
  insertInsight.run('risk', 'critical', 'Підозра на помилкове оформлення Fresh Cat', 'По товару FRESH-CAT-4P-3 «4 протеїни для котів» зафіксовано 2 відвантаження без комерційної логіки: знижка 100%, promo_type не вказаний. Це може бути помилка оформлення. Перевірте замовлення ORD-10234 та ORD-10567.', 3, 'gross_margin_pct', 0.75);
  insertInsight.run('recommendation', 'info', 'Зростання попиту на Смаколики', 'Категорія «Practik Смаколик» показує стабільне зростання +12% за останній місяць. Найкращі результати у Палички з качкою та Медальйони з яловичиною. Рекомендація: розглянути збільшення запасів та промо-активність.', null, 'sales_volume', 0.88);
  insertInsight.run('insight', 'info', 'Канал Marketplace обганяє Wholesale', 'Вперше за квартал prod. через маркетплейси (Розетка, Prom.ua) перевищили оптові на 8%. Маржинальність через маркетплейси на 3 п.п. вище. Лінійка Simple — найпопулярніша на маркетплейсах.', null, 'revenue_mtd', 0.79);
  insertInsight.run('risk', 'warning', 'Practik Box для кошенят — повільний старт', 'Товар BOX-KITTEN запущено 7 днів тому. Порівняно з аналогічними запусками, продажі на 35% нижче очікуваного. Можливі причини: недостатня промо-підтримка на сайті, мала впізнаваність формату.', 42, 'sales_volume', 0.71);
  insertInsight.run('recommendation', 'info', 'Оптимізація знижок по менеджеру Ткаченко М.', 'Менеджер Максим Ткаченко застосовує знижки в 2.3 рази частіше за середнє по команді. Середня знижка: 14.2% проти 6.8% у інших. Рекомендація: провести review політики знижок для лінійки Daily.', null, 'gross_margin_pct', 0.85);

  // ─── Complaints seed data ───────────────────────────────────
  seedComplaints(db, allProducts);

  console.log('✅ Database seeded with demo data');
}

// ─── Marketing Migrations (run independently) ────────────────
function runMigrations(db) {
  // Marketing tables — always CREATE IF NOT EXISTS
  const marketingExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='marketing_channels'").get();

  db.exec(`
    -- Marketing channel reference
    CREATE TABLE IF NOT EXISTS marketing_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      platform TEXT,
      icon TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    -- Weekly channel performance data
    CREATE TABLE IF NOT EXISTS marketing_weekly_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      channel_id INTEGER NOT NULL REFERENCES marketing_channels(id),
      ad_spend REAL DEFAULT 0,
      ad_conversions_value REAL DEFAULT 0,
      crm_revenue REAL DEFAULT 0,
      crm_orders INTEGER DEFAULT 0,
      crm_new_clients INTEGER DEFAULT 0,
      traffic INTEGER DEFAULT 0,
      source TEXT DEFAULT 'manual',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(week_start, channel_id)
    );

    -- Weekly site-wide metrics (GA4)
    CREATE TABLE IF NOT EXISTS marketing_site_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL UNIQUE,
      total_traffic INTEGER DEFAULT 0,
      cost_per_user REAL DEFAULT 0,
      cart_to_purchase_rate REAL DEFAULT 0,
      traffic_conversion_rate REAL DEFAULT 0,
      avg_session_duration INTEGER DEFAULT 0,
      engagement_rate REAL DEFAULT 0,
      source TEXT DEFAULT 'manual',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Weekly B2C sales totals
    CREATE TABLE IF NOT EXISTS marketing_sales_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL UNIQUE,
      incoming_orders INTEGER DEFAULT 0,
      incoming_orders_sum REAL DEFAULT 0,
      shipped_orders INTEGER DEFAULT 0,
      shipped_orders_sum REAL DEFAULT 0,
      ship_conversion_rate REAL DEFAULT 0,
      avg_check REAL DEFAULT 0,
      total_clients INTEGER DEFAULT 0,
      new_clients INTEGER DEFAULT 0,
      returning_clients INTEGER DEFAULT 0,
      cold_clients INTEGER DEFAULT 0,
      source TEXT DEFAULT 'manual',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Sync log
    CREATE TABLE IF NOT EXISTS marketing_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL,
      rows_affected INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Page access control (infrastructure for future role-based access)
    CREATE TABLE IF NOT EXISTS app_page_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_slug TEXT NOT NULL,
      role TEXT NOT NULL,
      can_view INTEGER DEFAULT 1,
      can_edit INTEGER DEFAULT 0,
      UNIQUE(page_slug, role)
    );


    CREATE INDEX IF NOT EXISTS idx_mwd_week ON marketing_weekly_data(week_start);
    CREATE INDEX IF NOT EXISTS idx_mwd_channel ON marketing_weekly_data(channel_id);
    CREATE INDEX IF NOT EXISTS idx_msd_week ON marketing_site_data(week_start);
    CREATE INDEX IF NOT EXISTS idx_msales_week ON marketing_sales_data(week_start);

    -- ─── Audit Log ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      user_id INTEGER,
      user_name TEXT,
      old_value TEXT,
      new_value TEXT,
      description TEXT,
      source TEXT DEFAULT 'system',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);

    -- ─── Performance Indexes (production-scale) ─────────────
    CREATE INDEX IF NOT EXISTS idx_orders_date ON core_sales_orders(order_date);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON core_sales_orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON core_sales_order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON core_sales_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_product ON core_complaints(product_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_date ON core_complaints(complaint_date);
    CREATE INDEX IF NOT EXISTS idx_complaints_status ON core_complaints(status);
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id);
  `);

  // ─── User table extensions (safe ALTER — ignore if columns exist) ──
  const safeAlter = (sql) => { try { db.exec(sql); } catch {} };
  safeAlter('ALTER TABLE app_users ADD COLUMN department TEXT');
  safeAlter('ALTER TABLE app_users ADD COLUMN permissions TEXT DEFAULT \'[]\'');

  // ─── Seed page access for new roles ──────────────────────
  const insertAccess2 = db.prepare(
    'INSERT OR IGNORE INTO app_page_access (page_slug, role, can_view, can_edit) VALUES (?,?,?,?)'
  );
  // Manager can view most pages but not admin
  insertAccess2.run('analytics', 'manager', 1, 0);
  insertAccess2.run('marketing', 'manager', 1, 0);
  insertAccess2.run('complaints', 'manager', 1, 0);
  insertAccess2.run('products', 'manager', 1, 0);
  // Viewer can only view
  insertAccess2.run('analytics', 'viewer', 1, 0);

  if (!marketingExists) {
    seedMarketing(db);
  }
}

function seedMarketing(db) {
  // ─── Channels ───────────────────────────────────────────
  const insertChannel = db.prepare(
    'INSERT INTO marketing_channels (name, display_name, platform, icon, sort_order) VALUES (?,?,?,?,?)'
  );
  const channels = [
    ['google_ads', 'Google ADS', 'google', '🔍', 1],
    ['meta_shark', 'Meta SHARK', 'meta', '🦈', 2],
    ['meta_buntar', 'Meta BUNTAR', 'meta', '🦁', 3],
    ['tiktok_ads', 'TikTok ADS', 'tiktok', '🎵', 4],
    ['viber', 'Viber', 'viber', '💬', 5],
    ['instagram_bio', 'Instagram (шапка)', 'instagram', '📷', 6],
    ['google_organic', 'Google Organic', 'google', '🌿', 7],
  ];
  for (const c of channels) insertChannel.run(...c);

  // ─── Page Access (default: both roles can view marketing) ─────
  const insertAccess = db.prepare(
    'INSERT OR IGNORE INTO app_page_access (page_slug, role, can_view, can_edit) VALUES (?,?,?,?)'
  );
  insertAccess.run('marketing', 'owner', 1, 0);
  insertAccess.run('marketing', 'developer', 1, 1);
  insertAccess.run('analytics', 'owner', 1, 0);
  insertAccess.run('analytics', 'developer', 1, 1);
  insertAccess.run('complaints', 'owner', 1, 1);
  insertAccess.run('complaints', 'developer', 1, 1);
  insertAccess.run('admin', 'developer', 1, 1);

  // ── Week definitions from the Google Sheet ─────────────────
  const weeks = [
    ['2026-01-26', '2026-02-01'],
    ['2026-02-02', '2026-02-08'],
    ['2026-02-09', '2026-02-15'],
    ['2026-02-16', '2026-02-22'],
    ['2026-02-23', '2026-03-01'],
    ['2026-03-02', '2026-03-08'],
    ['2026-03-09', '2026-03-15'],
    ['2026-03-16', '2026-03-22'],
    ['2026-03-23', '2026-03-29'],
  ];

  // ─── B2C Sales Data (per week) ─────────────────────────────
  const insertSales = db.prepare(`INSERT INTO marketing_sales_data
    (week_start, incoming_orders, incoming_orders_sum, shipped_orders, shipped_orders_sum,
     ship_conversion_rate, avg_check, total_clients, new_clients, returning_clients, cold_clients, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

  const salesData = [
    // [incoming, incomingSum, shipped, shippedSum, convRate, avgCheck, totalClients, new, returning, cold]
    [4029, 5720805, 3757, 5363110, 93.25, 1483, 151580, 463, 3361, 147],
    [4307, 6450377, 4151, 6311203, 96.38, 1668, 152043, 430, 3784, 182],
    [3790, 5696701, 3551, 5248662, 93.69, 1478, 152473, 373, 3252, 146],
    [3458, 5284836, 3078, 4656572, 89.01, 1513, 152846, 282, 2881, 161],
    [4375, 6924710, 4428, 7064489, 101.21, 1595, 153128, 352, 4145, 207],
    [3539, 5924688, 3447, 5695080, 97.40, 1652, 153365, 281, 3204, 144],
    [3678, 6059034, 3488, 5732533, 94.83, 1644, 153978, 613, 2925, 181],
    [3505, 7494347, 3431, 5643396, 97.89, 1645, 155135, 1157, 2274, 162],
    [3339, 5580006, 3190, 5277882, 95.54, 1655, 156209, 1074, 2116, 145],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const s = salesData[i];
    insertSales.run(weeks[i][0], s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], 'sheets');
  }

  // ─── Channel Data (per week per channel) ───────────────────
  const insertWeekly = db.prepare(`INSERT INTO marketing_weekly_data
    (week_start, week_end, channel_id, ad_spend, ad_conversions_value,
     crm_revenue, crm_orders, crm_new_clients, traffic, source)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  // Google ADS (channel_id=1)
  const googleAds = [
    [87911, 2139524, 2747580, 1912, 191, 8459],
    [93397, 2439524, 3188438, 2199, 203, 8904],
    [64840, 1998068, 2921096, 1977, 164, 6424],
    [37750, 2198322, 2640544, 1720, 114, 5252],
    [36277, 2023075, 3583089, 2289, 179, 5340],
    [49137, 1806657, 3080059, 1858, 120, 4969],
    [56377, 1849890, 3133821, 1900, 293, 5500],
    [85897, 1765299, 3050015, 1851, 602, 7010],
    [140379, 1689097, 2871395, 1728, 533, 8012],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const d = googleAds[i];
    insertWeekly.run(weeks[i][0], weeks[i][1], 1, d[0], d[1], d[2], d[3], d[4], d[5], 'sheets');
  }

  // Meta SHARK (channel_id=2)
  const metaShark = [
    [100921, 647752, 185890, 160, 56, 8886],
    [100792, 927037, 214760, 196, 52, 11162],
    [66177, 676777, 114805, 99, 28, 7707],
    [59942, 550185, 106812, 82, 8, 6404],
    [61103, 854582, 88892, 74, 16, 6792],
    [66484, 628188, 100052, 69, 21, 7549],
    [79992, 722084, 89286, 66, 23, 8789],
    [100645, 690760, 91195, 72, 42, 13116],
    [103524, 469364, 68304, 48, 30, 14452],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const d = metaShark[i];
    insertWeekly.run(weeks[i][0], weeks[i][1], 2, d[0], d[1], d[2], d[3], d[4], d[5], 'sheets');
  }

  // Meta BUNTAR (channel_id=3)
  const metaBuntar = [
    [118766, 888810, 112842, 105, 29, 22026],
    [85656, 1019306, 180623, 124, 15, 19343],
    [45752, 786934, 128632, 100, 7, 8664],
    [40420, 767980, 116249, 87, 7, 7299],
    [43731, 918351, 149064, 101, 4, 7476],
    [58328, 879436, 160329, 113, 9, 7697],
    [91852, 1005163, 139128, 104, 29, 10384],
    [125677, 1121939, 155372, 110, 32, 18828],
    [149026, 1187319, 150782, 114, 52, 13303],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const d = metaBuntar[i];
    insertWeekly.run(weeks[i][0], weeks[i][1], 3, d[0], d[1], d[2], d[3], d[4], d[5], 'sheets');
  }

  // TikTok ADS (channel_id=4)
  const tiktok = [
    [56786, 454288, 22744, 19, 7, 58860],
    [39623, 475476, 37127, 36, 10, 34003],
    [24530, 336061, 38821, 35, 5, 10191],
    [25396, 462207, 38268, 29, 3, 16893],
    [27797, 466990, 64069, 44, 15, 17311],
    [29832, 477312, 42464, 27, 4, 36155],
    [37799, 442248, 33177, 22, 1, 32004],
    [25345, 464575, 43380, 28, 10, 18341],
    [30805, 331563, 48920, 33, 11, 15208],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const d = tiktok[i];
    insertWeekly.run(weeks[i][0], weeks[i][1], 4, d[0], d[1], d[2], d[3], d[4], d[5], 'sheets');
  }

  // Viber (channel_id=5)
  const viber = [
    [0, 0, 523614, 370, 0, 0],
    [0, 0, 322351, 200, 0, 0],
    [0, 0, 195448, 124, 0, 0],
    [0, 0, 159603, 101, 0, 0],
    [12234, 0, 455552, 280, 0, 0],
    [0, 0, 235918, 159, 0, 0],
    [0, 0, 398779, 237, 0, 0],
    [0, 0, 349369, 198, 0, 0],
    [0, 0, 329865, 195, 0, 0],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const d = viber[i];
    insertWeekly.run(weeks[i][0], weeks[i][1], 5, d[0], d[1], d[2], d[3], d[4], d[5], 'sheets');
  }

  // Instagram bio (channel_id=6)
  const instagram = [
    [0, 0, 151184, 124, 21, 371],
    [0, 0, 169710, 113, 13, 674],
    [0, 0, 135711, 99, 13, 518],
    [0, 0, 124486, 89, 11, 543],
    [0, 0, 188741, 142, 9, 552],
    [0, 0, 168836, 111, 17, 480],
    [0, 0, 165045, 120, 28, 588],
    [0, 0, 157302, 106, 31, 606],
    [0, 0, 127723, 96, 40, 582],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const d = instagram[i];
    insertWeekly.run(weeks[i][0], weeks[i][1], 6, d[0], d[1], d[2], d[3], d[4], d[5], 'sheets');
  }

  // Google Organic (channel_id=7)
  const organic = [
    [0, 0, 143138, 104, 0, 1354],
    [0, 0, 188544, 123, 0, 1314],
    [0, 0, 211672, 117, 0, 1212],
    [0, 0, 160709, 113, 0, 1205],
    [0, 0, 227891, 133, 0, 1167],
    [0, 0, 234310, 116, 0, 1111],
    [0, 0, 206477, 117, 0, 1073],
    [0, 0, 184683, 110, 0, 1092],
    [0, 0, 218324, 129, 0, 1045],
  ];
  for (let i = 0; i < weeks.length; i++) {
    const d = organic[i];
    insertWeekly.run(weeks[i][0], weeks[i][1], 7, d[0], d[1], d[2], d[3], d[4], d[5], 'sheets');
  }

  // ─── Site Data (GA4 — only available from week 6 onwards) ──
  const insertSite = db.prepare(`INSERT INTO marketing_site_data
    (week_start, total_traffic, cost_per_user, cart_to_purchase_rate,
     traffic_conversion_rate, avg_session_duration, engagement_rate, source)
    VALUES (?,?,?,?,?,?,?,?)`);

  const siteData = [
    // weeks 1-5: no GA4 data in the sheet
    // week 6 (02.03-08.03)
    ['2026-03-02', 64967, 3.14, 27.23, 2.90, 34, 43.21],
    ['2026-03-09', 80120, 3.32, 27.79, 2.49, 28, 43.38],
    ['2026-03-16', 74216, 4.55, 26.97, 2.57, 30, 39.86],
    ['2026-03-23', 67598, 6.27, 28.90, 2.72, 33, 41.87],
  ];
  for (const s of siteData) {
    insertSite.run(s[0], s[1], s[2], s[3], s[4], s[5], s[6], 'sheets');
  }

  console.log('✅ Marketing data seeded (9 weeks, 7 channels)');
}

// Seeded random for reproducible demo data
function seedRandom(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function gaussRng(rng, mean, std) {
  const u1 = rng(), u2 = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function weightedChoice(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total, acc = 0;
  for (let i = 0; i < weights.length; i++) { acc += weights[i]; if (r < acc) return i; }
  return weights.length - 1;
}

function weightedProductChoice(rng, products) {
  const weights = products.map(p => {
    if (p.status === 'new') return 0.5;
    // Fresh (1,2) — premium, less volume but high revenue
    if (p.category_id <= 2) return 1.5;
    // Simple (3,4) — most popular, highest volume
    if (p.category_id <= 4) return 2.5;
    // Daily (5,6) — budget, high volume
    if (p.category_id <= 6) return 2.0;
    // Смаколик (7) — add-on purchases
    if (p.category_id === 7) return 0.8;
    // SuperFood (8) — niche
    if (p.category_id === 8) return 0.5;
    // Box (9) — trial sets
    return 0.6;
  });
  return weightedChoice(rng, weights);
}

function seedComplaints(db, products) {
  const insertComplaint = db.prepare(
    'INSERT INTO core_complaints (product_id, complaint_date, batch_number, source, description, status, severity) VALUES (?,?,?,?,?,?,?)'
  );
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(today - n * 86400000);
  const rng = seedRandom(777);

  const sources = ['клієнт', 'маркетплейс', 'дистриб\'ютор', 'соцмережі', 'гаряча лінія'];
  const descriptions = [
    'Тварина відмовляється їсти корм',
    'Неприємний запах з пакування',
    'Зміна кольору гранул порівняно з попереднім пакуванням',
    'Алергічна реакція після переходу на новий пакет',
    'Порушена цілісність упаковки при отриманні',
    'Шлункові розлади у тварини',
    'Виявлено сторонній предмет у кормі',
    'Невідповідність ваги зазначеній на упаковці',
    'Гранули занадто тверді / розсипаються',
    'Різкий перехід текстури порівняно з попередньою партією',
    'Блювота після годування новим пакетом',
    'Свербіж та подразнення шкіри у тварини',
    'Потемніння гранул, підозра на порушення зберігання',
    'Тварина стала млявою після переходу на цю партію',
    'Плісень на гранулах при відкритті пакета',
  ];
  const statuses = ['new', 'investigating', 'resolved', 'dismissed'];
  const severities = ['low', 'medium', 'high'];

  // ── Cluster 1: product 4 (Simple Качка) ~25 days ago, 4 complaints in 3 days (batch P2026-0218)
  const cluster1Prod = products.length > 3 ? products[3] : products[0];
  const cluster1Batch = 'P2026-0218';
  [
    [25, 'Тварина відмовляється їсти корм, різкий запах', 'клієнт', 'high', 'investigating'],
    [24, 'Зміна кольору гранул, тварина не їсть', 'маркетплейс', 'high', 'investigating'],
    [24, 'Шлункові розлади після годування', 'гаряча лінія', 'high', 'investigating'],
    [23, 'Алергічна реакція, свербіж', 'клієнт', 'medium', 'investigating'],
  ].forEach(([ago, desc, src, sev, st]) => {
    insertComplaint.run(cluster1Prod.id, fmt(daysAgo(ago)), cluster1Batch, src, desc, st, sev);
  });

  // ── Cluster 2: product 10 (Simple Cat Лосось) ~12 days ago, 3 complaints (batch P2026-0301)
  const cluster2Prod = products.length > 10 ? products[10] : products[1];
  const cluster2Batch = 'P2026-0301';
  [
    [12, 'Блювота після годування новим пакетом', 'клієнт', 'high', 'new'],
    [11, 'Тварина відмовляється їсти, раніше їла з задоволенням', 'дистриб\'ютор', 'medium', 'new'],
    [10, 'Різкий перехід текстури, гранули розсипаються', 'маркетплейс', 'medium', 'new'],
  ].forEach(([ago, desc, src, sev, st]) => {
    insertComplaint.run(cluster2Prod.id, fmt(daysAgo(ago)), cluster2Batch, src, desc, st, sev);
  });

  // ── Cluster 3: product 15 (Daily Dog Курка) ~45 days ago, 5 complaints (batch P2026-0128) — resolved
  const cluster3Prod = products.length > 15 ? products[15] : products[2];
  const cluster3Batch = 'P2026-0128';
  [
    [47, 'Плісень на гранулах при відкритті', 'клієнт', 'high', 'resolved'],
    [46, 'Потемніння гранул, неприємний запах', 'маркетплейс', 'high', 'resolved'],
    [45, 'Тварина стала млявою', 'гаряча лінія', 'medium', 'resolved'],
    [45, 'Шлункові розлади у собаки', 'клієнт', 'high', 'resolved'],
    [44, 'Підозра на порушення зберігання', 'дистриб\'ютор', 'medium', 'resolved'],
  ].forEach(([ago, desc, src, sev, st]) => {
    insertComplaint.run(cluster3Prod.id, fmt(daysAgo(ago)), cluster3Batch, src, desc, st, sev);
  });

  // ── Scattered individual complaints over 90 days (background noise, ~30 more)
  const scatterData = [
    [88, 0, 'Порушена упаковка', 'клієнт', 'low', 'dismissed'],
    [82, 2, 'Невідповідність ваги', 'маркетплейс', 'low', 'resolved'],
    [75, 5, 'Тварина не їсть', 'клієнт', 'medium', 'resolved'],
    [70, 8, 'Гранули занадто тверді', 'соцмережі', 'low', 'dismissed'],
    [65, 1, 'Алергічна реакція', 'гаряча лінія', 'medium', 'resolved'],
    [60, 12, 'Зміна кольору', 'маркетплейс', 'low', 'resolved'],
    [55, 6, 'Неприємний запах', 'клієнт', 'medium', 'resolved'],
    [50, 14, 'Шлункові розлади', 'дистриб\'ютор', 'medium', 'investigating'],
    [42, 3, 'Тварина не їсть', 'клієнт', 'low', 'dismissed'],
    [38, 9, 'Порушена упаковка', 'маркетплейс', 'low', 'resolved'],
    [35, 7, 'Свербіж та подразнення', 'клієнт', 'medium', 'resolved'],
    [30, 11, 'Невідповідність ваги', 'гаряча лінія', 'low', 'resolved'],
    [28, 4, 'Рясне линяння після зміни корму', 'соцмережі', 'medium', 'investigating'],
    [22, 13, 'Гранули розсипаються', 'маркетплейс', 'low', 'resolved'],
    [18, 0, 'Тварина відмовляється їсти', 'клієнт', 'medium', 'new'],
    [15, 6, 'Зміна текстури', 'дистриб\'ютор', 'low', 'new'],
    [14, 2, 'Алергічна реакція', 'клієнт', 'medium', 'new'],
    [9, 8, 'Неприємний запах', 'маркетплейс', 'medium', 'new'],
    [7, 5, 'Порушена цілісність пакування', 'клієнт', 'low', 'new'],
    [6, 1, 'Шлункові розлади', 'гаряча лінія', 'medium', 'new'],
    [5, 14, 'Тварина не їсть', 'клієнт', 'low', 'new'],
    [4, 9, 'Зміна кольору гранул', 'соцмережі', 'low', 'new'],
    [3, 3, 'Невідповідність ваги', 'маркетплейс', 'low', 'new'],
    [2, 7, 'Гранули заліплені разом', 'клієнт', 'medium', 'new'],
    [1, 12, 'Тварина стала млявою', 'дистриб\'ютор', 'medium', 'new'],
  ];

  for (const [ago, prodIdx, desc, src, sev, st] of scatterData) {
    const prod = products[prodIdx % products.length];
    const batch = rng() < 0.4 ? `P2026-${String(Math.floor(rng() * 300) + 1).padStart(4, '0')}` : null;
    insertComplaint.run(prod.id, fmt(daysAgo(ago)), batch, src, desc, st, sev);
  }
}