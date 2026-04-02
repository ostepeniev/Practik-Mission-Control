const API_URL = '';  // Same origin for Next.js API routes

class ApiClient {
  constructor() {
    this.token = null;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('practik_token');
    }
  }

  setToken(token) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('practik_token', token);
    }
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('practik_token');
      localStorage.removeItem('practik_user');
    }
  }

  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_URL}${path}`, { ...options, headers });

    if (res.status === 401) {
      this.clearToken();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    return res.json();
  }

  get(path) { return this.request(path); }
  post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); }
  patch(path, body) { return this.request(path, { method: 'PATCH', body: JSON.stringify(body) }); }

  // Auth
  async login(username, password) {
    const data = await this.post('/api/auth/login', { username, password });
    if (data.token) {
      this.setToken(data.token);
      if (typeof window !== 'undefined') localStorage.setItem('practik_user', JSON.stringify(data.user));
    }
    return data;
  }

  logout() { this.clearToken(); }

  getUser() {
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('practik_user');
      return u ? JSON.parse(u) : null;
    }
    return null;
  }

  // Metrics
  getOverview(params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/metrics/overview${q ? '?'+q : ''}`); }
  getProducts(params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/metrics/products${q ? '?'+q : ''}`); }
  getProductDetail(id, days = 30) { return this.get(`/api/metrics/products/${id}?days=${days}`); }
  getSeries(metric, params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/metrics/series/${metric}${q ? '?'+q : ''}`); }
  getTopProducts(params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/metrics/top-products${q ? '?'+q : ''}`); }
  getTopCustomers(params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/metrics/top-customers${q ? '?'+q : ''}`); }
  getAlerts(params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/metrics/alerts${q ? '?'+q : ''}`); }

  // AI
  getInsights(limit = 10) { return this.get(`/api/ai/insights?limit=${limit}`); }
  askAI(question, productId, context) { return this.post('/api/ai/insights', { question, product_id: productId, context }); }
  sendAIMessage(message, conversationId, pageContext) {
    return this.post('/api/ai/chat', {
      message,
      conversation_id: conversationId,
      page_context: pageContext ? {
        page: pageContext.page,
        product_id: pageContext.productId || null,
      } : null,
    });
  }
  getConversations() { return this.get('/api/ai/conversations'); }
  getConversation(id) { return this.get(`/api/ai/conversations/${id}`); }
  deleteConversation(id) { return this.request(`/api/ai/conversations/${id}`, { method: 'DELETE' }); }

  // Admin
  getFeatures() { return this.get('/api/admin/features'); }
  toggleFeature(key, enabled) { return this.patch(`/api/admin/features/${key}`, { is_enabled: enabled }); }
  getWidgets() { return this.get('/api/admin/widgets'); }
  toggleWidget(id, visible) { return this.patch(`/api/admin/widgets/${id}`, { is_visible_owner: visible }); }
  getCategories() { return this.get('/api/admin/categories'); }
  changePassword(data) { return this.post('/api/admin/change-password', data); }
  getUsers() { return this.get('/api/admin/users'); }

  // Marketing
  getMarketingOverview() { return this.get('/api/marketing?view=overview'); }
  getMarketingChannels() { return this.get('/api/marketing?view=channels'); }
  getMarketingWeeks() { return this.get('/api/marketing?view=weeks'); }
  getMarketingAlerts() { return this.get('/api/marketing?view=alerts'); }
  syncMarketingSheets() { return this.post('/api/marketing/sync', {}); }

  // Complaints
  getComplaints(params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/complaints${q ? '?'+q : ''}`); }
  createComplaint(data) { return this.post('/api/complaints', data); }
  updateComplaint(id, data) { return this.patch(`/api/complaints/${id}`, data); }
  deleteComplaint(id) { return this.request(`/api/complaints/${id}`, { method: 'DELETE' }); }
  getComplaintsSummary(params = {}) { const q = new URLSearchParams(params).toString(); return this.get(`/api/complaints/summary${q ? '?'+q : ''}`); }
}

const api = new ApiClient();
export default api;
