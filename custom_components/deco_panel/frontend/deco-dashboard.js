const GROUP_MODES = ['deco', 'split', 'flat'];
const GROUP_MODE_STORAGE_KEY = 'deco-panel-group-mode';
const UNKNOWN_GROUP_KEY = '__unknown__';
const NODES_GROUP_KEY = '__nodes__';
const DEVICES_GROUP_KEY = '__devices__';
const WIFI_ICON = '<svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';

class DecoDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this.devices = []; // Decos + clients, used for selection lookup
    this.decos = [];
    this.clients = [];
    this.selectedMac = null;
    this.rendered = false;
    this.showConnected = true;
    this.groupOpenStates = {};

    // Sort and grouping controls
    this.sortBy = 'name'; // 'name' | 'ip' | 'mac'
    this.sortOrder = 'asc'; // 'asc' | 'desc'
    this.groupMode = this.loadGroupMode(); // 'deco' | 'split' | 'flat'

    // For mobile drill-down navigation ('list' or 'details')
    this.mobileView = 'list';
  }

  loadGroupMode() {
    try {
      const stored = window.localStorage.getItem(GROUP_MODE_STORAGE_KEY);
      if (GROUP_MODES.includes(stored)) return stored;
    } catch (e) {
      // localStorage unavailable (private mode, etc.): fall back to default
    }
    return 'deco';
  }

  saveGroupMode() {
    try {
      window.localStorage.setItem(GROUP_MODE_STORAGE_KEY, this.groupMode);
    } catch (e) {
      // Ignore persistence errors
    }
  }

  // ha-tplink-deco appends " Deco" to Deco names by default ("Buanderie Deco").
  // The role badge already says it's a Deco, so drop the redundant suffix.
  stripDecoSuffix(name) {
    const stripped = name.replace(/\s+deco$/i, '').trim();
    return stripped || name;
  }

  normalizeMac(mac) {
    return String(mac || '').trim().toLowerCase();
  }

  matchesFilter(item) {
    return this.showConnected ? item.state === 'home' : item.state !== 'home';
  }

  // Main Deco always first, then satellites (and unknown roles) by the current sort
  sortDecos(decoList) {
    const mains = decoList.filter(d => d.role === 'main');
    const others = decoList.filter(d => d.role !== 'main');
    return [...this.sortDevices(mains), ...this.sortDevices(others)];
  }

  getRoleBadgeHtml(role) {
    if (role === 'main') return '<span class="role-badge main">Main</span>';
    if (role === 'satellite') return '<span class="role-badge satellite">Satellite</span>';
    return '';
  }

  getStatusDotClass(item) {
    if (item.state === 'home') return 'online';
    return item.isDeco ? 'offline deco-offline' : 'offline';
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  compareIP(ipA, ipB) {
    if (!ipA && !ipB) return 0;
    if (!ipA) return 1;
    if (!ipB) return -1;

    const partsA = String(ipA).trim().split('.');
    const partsB = String(ipB).trim().split('.');

    if (partsA.length === 4 && partsB.length === 4) {
      for (let i = 0; i < 4; i++) {
        const numA = parseInt(partsA[i], 10);
        const numB = parseInt(partsB[i], 10);
        const valA = isNaN(numA) ? 0 : numA;
        const valB = isNaN(numB) ? 0 : numB;
        if (valA !== valB) {
          return valA - valB;
        }
      }
      return 0;
    }

    return String(ipA).localeCompare(String(ipB), undefined, { numeric: true, sensitivity: 'base' });
  }

  parseMacBytes(mac) {
    if (!mac) return null;
    const clean = String(mac).trim();
    const parts = clean.split(/[:-]/);
    if (parts.length === 6) {
      const nums = parts.map(p => parseInt(p, 16));
      if (nums.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
        return nums;
      }
    }
    const hexOnly = clean.replace(/[^0-9a-fA-F]/g, '');
    if (hexOnly.length === 12) {
      const nums = [];
      for (let i = 0; i < 12; i += 2) {
        nums.push(parseInt(hexOnly.slice(i, i + 2), 16));
      }
      return nums;
    }
    return null;
  }

  compareMAC(macA, macB) {
    const bytesA = this.parseMacBytes(macA);
    const bytesB = this.parseMacBytes(macB);

    if (bytesA && bytesB) {
      for (let i = 0; i < 6; i++) {
        if (bytesA[i] !== bytesB[i]) {
          return bytesA[i] - bytesB[i];
        }
      }
      return 0;
    }

    if (bytesA) return -1;
    if (bytesB) return 1;

    return String(macA || '').toLowerCase().localeCompare(String(macB || '').toLowerCase());
  }

  compareName(nameA, nameB) {
    return String(nameA || '').localeCompare(String(nameB || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  sortDevices(deviceList) {
    return [...deviceList].sort((a, b) => {
      let result = 0;
      if (this.sortBy === 'ip') {
        if (!a.ip && !b.ip) return 0;
        if (!a.ip) return 1;
        if (!b.ip) return -1;
        result = this.compareIP(a.ip, b.ip);
      } else if (this.sortBy === 'mac') {
        if (!a.mac && !b.mac) return 0;
        if (!a.mac) return 1;
        if (!b.mac) return -1;
        result = this.compareMAC(a.mac, b.mac);
      } else {
        if (!a.name && !b.name) return 0;
        if (!a.name) return 1;
        if (!b.name) return -1;
        result = this.compareName(a.name, b.name);
      }

      if (result === 0 && this.sortBy !== 'name') {
        result = this.compareName(a.name, b.name);
      }

      return this.sortOrder === 'desc' ? -result : result;
    });
  }

  updateToolbarUI() {
    const sortSelect = this.shadowRoot.getElementById('sort-select');
    if (sortSelect && sortSelect.value !== this.sortBy) {
      sortSelect.value = this.sortBy;
    }

    const sortDirBtn = this.shadowRoot.getElementById('sort-dir-btn');
    if (sortDirBtn) {
      sortDirBtn.className = `control-btn ${this.sortOrder}`;
      const isAsc = this.sortOrder === 'asc';
      sortDirBtn.title = `Sort order: ${isAsc ? 'Ascending' : 'Descending'} (Click to change)`;
      sortDirBtn.setAttribute('aria-label', `Sort order: ${isAsc ? 'Ascending' : 'Descending'}`);
      sortDirBtn.innerHTML = isAsc
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4"/></svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10M11 9h7M11 13h4M3 7l3-3 3 3M6 6v14"/></svg>`;
    }

    const groupSelect = this.shadowRoot.getElementById('group-select');
    if (groupSelect && groupSelect.value !== this.groupMode) {
      groupSelect.value = this.groupMode;
    }
  }

  set hass(hass) {
    try {
      this._hass = hass;
      this.processData();
      if (!this.rendered) {
        this.render();
        this.rendered = true;
      } else {
        this.updateUI();
      }
    } catch (e) {
      this.shadowRoot.innerHTML = `<div style="color:red; padding:20px;">Error rendering: ${e.message}</div>`;
    }
  }

  processData() {
    if (!this._hass) return;
    
    const allStates = Object.values(this._hass.states);
    // Decos are kept even without an IP (e.g. an offline satellite that never reported one)
    const trackers = allStates.filter(state =>
      state.entity_id &&
      state.entity_id.startsWith('device_tracker.') &&
      state.attributes &&
      state.attributes.mac &&
      (state.attributes.ip || state.attributes.device_type === 'deco')
    );

    const items = trackers.map(state => {
      const attrs = state.attributes;
      const isDeco = attrs.device_type === 'deco';
      let name = String(attrs.ui_device_name || attrs.friendly_name || state.entity_id);
      if (isDeco) name = this.stripDecoSuffix(name);
      let role = null;
      if (isDeco && attrs.master === true) role = 'main';
      else if (isDeco && attrs.master === false) role = 'satellite';
      return {
        entity_id: state.entity_id,
        name: String(name),
        mac: attrs.mac,
        macKey: this.normalizeMac(attrs.mac),
        ip: attrs.ip || '',
        state: state.state,
        down: attrs.down_kilobytes_per_s || 0,
        up: attrs.up_kilobytes_per_s || 0,
        connection: attrs.connection_type || 'Unknown',
        isDeco,
        role, // 'main' | 'satellite' | null (unknown, e.g. right after an HA restart)
        model: attrs.device_model || null,
        swVersion: attrs.sw_version || null,
        decoMacKey: this.normalizeMac(attrs.deco_mac),
        decoName: attrs.deco_device || null,
        deco: null, // Parent Deco display name (clients only)
        groupKey: null // Parent Deco MAC key (clients only)
      };
    });

    this.decos = items.filter(item => item.isDeco);
    this.clients = items.filter(item => !item.isDeco);

    // Link each client to its Deco by MAC (unambiguous), falling back to the name
    const decoByMac = new Map(this.decos.map(d => [d.macKey, d]));
    const decoByName = new Map(this.decos.map(d => [d.name, d]));
    this.clients.forEach(client => {
      const parent = (client.decoMacKey && decoByMac.get(client.decoMacKey)) ||
        (client.decoName && decoByName.get(client.decoName)) ||
        null;
      client.groupKey = parent ? parent.macKey : UNKNOWN_GROUP_KEY;
      client.deco = parent ? parent.name : (client.decoName || 'Unknown Deco');
    });

    this.devices = items;

    if (!this.selectedMac && this.devices.length > 0) {
      this.selectedMac = this.devices[0].mac;
    }
  }

  updateUI() {
    // Determine HA theme (dark or light)
    const isDark = this._hass && this._hass.themes && this._hass.themes.darkMode !== undefined 
      ? this._hass.themes.darkMode 
      : true;

    // Update container classes based on mobile view state and theme
    const layout = this.shadowRoot.querySelector('.layout');
    if (layout) {
      layout.className = `layout mobile-view-${this.mobileView} ${isDark ? 'theme-dark' : 'theme-light'}`;
    }

    this.updateToolbarUI();

    const listContainer = this.shadowRoot.getElementById('device-list');
    const detailsContainer = this.shadowRoot.getElementById('device-details');
    
    if (listContainer) {
      const detailsEls = listContainer.querySelectorAll('details.deco-group');
      detailsEls.forEach(el => {
        this.groupOpenStates[el.dataset.deco] = el.open;
      });
    }

    if (listContainer) {
      let html = '';
      if (this.groupMode === 'deco') {
        html = this.getGroupedByDecoHtml();
      } else if (this.groupMode === 'split') {
        html = this.getSplitHtml();
      } else {
        html = this.getFlatHtml();
      }

      if (html) {
        listContainer.innerHTML = html;

        const items = listContainer.querySelectorAll('.device-item');
        items.forEach(item => {
          item.addEventListener('click', (e) => {
            this.selectDevice(e.currentTarget.dataset.mac);
          });
        });

        // Deco details button in mode 1 headers: must not toggle the <details>
        const infoBtns = listContainer.querySelectorAll('.group-info-btn');
        infoBtns.forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectDevice(e.currentTarget.dataset.mac);
          });
        });
      } else {
        listContainer.innerHTML = '<div class="empty-state" style="font-size:1rem;">No devices in this category.</div>';
      }
    }

    if (detailsContainer) {
      const selectedDevice = this.devices.find(d => d.mac === this.selectedMac);
      if (selectedDevice) {
        detailsContainer.innerHTML = this.getDetailsHtml(selectedDevice);
        
        // Bind the back button if it exists
        const backBtn = detailsContainer.querySelector('.mobile-back-btn');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            this.mobileView = 'list';
            this.updateUI();
          });
        }

        // Bind copy buttons
        const copyBtns = detailsContainer.querySelectorAll('.copy-btn');
        copyBtns.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const container = e.currentTarget.closest('.copy-container');
            const text = container.dataset.text;
            
            const showSuccess = () => {
              const iconCopy = btn.querySelector('.icon-copy');
              const iconCheck = btn.querySelector('.icon-check');
              if (iconCopy && iconCheck) {
                iconCopy.style.display = 'none';
                iconCheck.style.display = 'block';
                setTimeout(() => {
                  iconCopy.style.display = 'block';
                  iconCheck.style.display = 'none';
                }, 2000);
              }
            };

            const fallbackCopy = () => {
              const textArea = document.createElement("textarea");
              textArea.value = text;
              textArea.style.position = "fixed";
              textArea.style.top = "0";
              textArea.style.left = "0";
              textArea.style.width = "2em";
              textArea.style.height = "2em";
              textArea.style.padding = "0";
              textArea.style.border = "none";
              textArea.style.outline = "none";
              textArea.style.boxShadow = "none";
              textArea.style.background = "transparent";
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();
              try {
                document.execCommand('copy');
                showSuccess();
              } catch (err) {
                console.error("Fallback copy failed", err);
              }
              document.body.removeChild(textArea);
            };

            if (navigator.clipboard && window.isSecureContext) {
              navigator.clipboard.writeText(text)
                .then(showSuccess)
                .catch(() => fallbackCopy());
            } else {
              fallbackCopy();
            }
          });
        });
      } else {
        detailsContainer.innerHTML = `<div class="empty-state">
          <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
          Select a device
        </div>`;
      }
    }
  }

  selectDevice(mac) {
    this.selectedMac = mac;
    this.mobileView = 'details'; // Navigate to details on mobile
    this.updateUI();
  }

  getGroupHtml({ key, headerHtml, actionsHtml = '', count, contentHtml, defaultOpen, active = false }) {
    let isOpen = this.groupOpenStates[key];
    if (isOpen === undefined) isOpen = defaultOpen;
    return `
      <details class="deco-group" data-deco="${this.escapeHtml(key)}" ${isOpen ? 'open' : ''}>
        <summary class="group-title ${active ? 'active' : ''}">
          <div class="group-header-info">${headerHtml}</div>
          <div class="group-header-actions">
            ${actionsHtml}
            <span class="group-badge">${count}</span>
          </div>
        </summary>
        <div class="group-content">${contentHtml}</div>
      </details>
    `;
  }

  // Mode 1: one group per Deco (Main first), its clients inside.
  // A group shows if the Deco itself matches the filter, or any of its clients does.
  getGroupedByDecoHtml() {
    const filteredClients = this.clients.filter(c => this.matchesFilter(c));
    const emptyText = this.showConnected ? 'No connected devices' : 'No disconnected devices';
    let html = '';

    for (const deco of this.sortDecos(this.decos)) {
      const groupClients = this.sortDevices(filteredClients.filter(c => c.groupKey === deco.macKey));
      if (!this.matchesFilter(deco) && groupClients.length === 0) continue;

      const isDecoSelected = deco.mac === this.selectedMac;
      const safeName = this.escapeHtml(deco.name);
      const safeMac = this.escapeHtml(deco.mac);
      html += this.getGroupHtml({
        key: deco.macKey,
        headerHtml: `
          <div class="status-dot ${this.getStatusDotClass(deco)}"></div>
          <span class="group-name" title="${safeName}">${safeName}</span>
          ${this.getRoleBadgeHtml(deco.role)}
        `,
        actionsHtml: `
          <button class="group-info-btn ${isDecoSelected ? 'active' : ''}" data-mac="${safeMac}" title="Deco details" aria-label="Show details for ${safeName}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          </button>
        `,
        count: groupClients.length,
        contentHtml: groupClients.length > 0
          ? groupClients.map(c => this.getDeviceHtml(c, false)).join('')
          : `<div class="group-empty">${emptyText}</div>`,
        defaultOpen: groupClients.some(c => c.mac === this.selectedMac),
        active: isDecoSelected
      });
    }

    // Clients whose Deco could not be resolved
    const orphans = this.sortDevices(filteredClients.filter(c => c.groupKey === UNKNOWN_GROUP_KEY));
    if (orphans.length > 0) {
      html += this.getGroupHtml({
        key: UNKNOWN_GROUP_KEY,
        headerHtml: `${WIFI_ICON}<span class="group-name">Unknown Deco</span>`,
        count: orphans.length,
        contentHtml: orphans.map(c => this.getDeviceHtml(c, false)).join(''),
        defaultOpen: orphans.some(c => c.mac === this.selectedMac)
      });
    }

    return html;
  }

  // Mode 2: "Deco Nodes" section + "Devices" section, each filtered by its own items' state.
  getSplitHtml() {
    const nodes = this.sortDecos(this.decos.filter(d => this.matchesFilter(d)));
    const devices = this.sortDevices(this.clients.filter(c => this.matchesFilter(c)));
    let html = '';

    if (nodes.length > 0) {
      html += this.getGroupHtml({
        key: NODES_GROUP_KEY,
        headerHtml: `${WIFI_ICON}<span class="group-name">Deco Nodes</span>`,
        count: nodes.length,
        contentHtml: nodes.map(d => this.getDeviceHtml(d, false)).join(''),
        defaultOpen: true
      });
    }

    if (devices.length > 0) {
      html += this.getGroupHtml({
        key: DEVICES_GROUP_KEY,
        headerHtml: `
          <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          <span class="group-name">Devices</span>
        `,
        count: devices.length,
        contentHtml: devices.map(c => this.getDeviceHtml(c, true)).join(''),
        defaultOpen: true
      });
    }

    return html;
  }

  // Mode 3: flat list of Decos and clients, sorted globally.
  getFlatHtml() {
    const all = this.sortDevices(this.devices.filter(d => this.matchesFilter(d)));
    if (all.length === 0) return '';
    return `
      <div class="flat-list">
        ${all.map(d => this.getDeviceHtml(d, true)).join('')}
      </div>
    `;
  }

  getDeviceHtml(device, showDecoBadge = false) {
    const isSelected = device.mac === this.selectedMac;
    const safeName = this.escapeHtml(device.name);
    const safeMac = this.escapeHtml(device.mac);
    const safeIp = this.escapeHtml(device.ip);
    const safeDeco = this.escapeHtml(device.deco);

    let primaryBadge = '';
    if (this.sortBy === 'mac') {
      primaryBadge = `<span class="badge" title="MAC: ${safeMac}">${safeMac}</span>`;
    } else if (device.ip) {
      primaryBadge = `<span class="badge" title="IP: ${safeIp}">${safeIp}</span>`;
    }

    // Decos show their role; clients optionally show their parent Deco
    let secondaryBadge = '';
    if (device.isDeco) {
      secondaryBadge = this.getRoleBadgeHtml(device.role);
    } else if (showDecoBadge) {
      secondaryBadge = `<span class="badge deco-badge" title="Deco: ${safeDeco}">${safeDeco}</span>`;
    }

    return `
      <div class="device-item ${isSelected ? 'active' : ''}" data-mac="${safeMac}">
        <div class="device-header">
          <div class="status-dot ${this.getStatusDotClass(device)}"></div>
          <div class="device-name" title="${safeName}">${safeName}</div>
        </div>
        <div class="device-meta">
          ${primaryBadge}
          ${secondaryBadge}
        </div>
      </div>
    `;
  }

  getDetailsHtml(device) {
    const isConnected = device.state === 'home';
    let connType = Array.isArray(device.connection) ? device.connection.join(', ') : device.connection;
    if (connType === 'band5') connType = '5 GHz Wi-Fi';
    if (connType === 'band2_4') connType = '2.4 GHz Wi-Fi';
    if (connType === 'wired') connType = 'Ethernet (Wired)';
    
    const safeName = this.escapeHtml(device.name);
    const safeIp = this.escapeHtml(device.ip);
    const safeMac = this.escapeHtml(device.mac);
    const safeConnType = this.escapeHtml(connType);

    const layersIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>';
    const infoCard = (icon, label, value) => `
        <div class="info-card">
          <div class="card-icon">${icon}</div>
          <div class="card-content">
            <div class="card-label">${label}</div>
            <div class="card-value">${this.escapeHtml(value)}</div>
          </div>
        </div>`;

    let extraCardsHtml = '';
    if (device.isDeco) {
      const roleLabel = device.role === 'main' ? 'Main' : (device.role === 'satellite' ? 'Satellite' : 'Unknown');
      extraCardsHtml += infoCard(layersIcon, 'Deco Role', roleLabel);
      if (device.model) {
        extraCardsHtml += infoCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg>', 'Model', device.model);
      }
      if (device.swVersion) {
        extraCardsHtml += infoCard('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>', 'Firmware', device.swVersion);
      }
    } else {
      extraCardsHtml += infoCard(layersIcon, 'Parent Deco Node', device.deco);
    }

    return `
      <div class="details-header">
        <button class="mobile-back-btn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          Back
        </button>
        <div class="title-row">
          <div class="title-area">
            <div class="status-indicator ${isConnected ? 'online' : 'offline'}"></div>
            <div class="copy-container" data-text="${device.name.replace(/"/g, '&quot;')}">
              <h1>${safeName}</h1>
              <button class="copy-btn" aria-label="Copy Name" title="Copy">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-check" style="display:none; color:var(--accent-green);"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
            </div>
          </div>
          <div class="status-badge ${isConnected ? 'online' : 'offline'}">
            ${isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>
      
      <div class="cards-container">
        <div class="info-card">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          </div>
          <div class="card-content">
            <div class="card-label">IP Address</div>
            <div class="copy-container" data-text="${device.ip.replace(/"/g, '&quot;')}">
              <div class="card-value">${safeIp}</div>
              <button class="copy-btn" aria-label="Copy IP" title="Copy">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-check" style="display:none; color:var(--accent-green);"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
            </div>
          </div>
        </div>
        
        <div class="info-card">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
          </div>
          <div class="card-content">
            <div class="card-label">MAC Address</div>
            <div class="copy-container" data-text="${device.mac.replace(/"/g, '&quot;')}">
              <div class="card-value">${safeMac}</div>
              <button class="copy-btn" aria-label="Copy MAC" title="Copy">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-check" style="display:none; color:var(--accent-green);"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
            </div>
          </div>
        </div>

        <div class="info-card">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
          </div>
          <div class="card-content">
            <div class="card-label">Connection Type</div>
            <div class="card-value" style="text-transform: capitalize;">${safeConnType}</div>
          </div>
        </div>

        ${extraCardsHtml}
      </div>

      ${device.isDeco ? '' : `<div class="bandwidth-section">
        <h2>Network Activity</h2>
        <div class="cards-container">
          <div class="bw-card down">
            <div class="bw-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
              Download
            </div>
            <div class="bw-value">${device.down} <span class="unit">KB/s</span></div>
          </div>
          
          <div class="bw-card up">
            <div class="bw-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
              Upload
            </div>
            <div class="bw-value">${device.up} <span class="unit">KB/s</span></div>
          </div>
        </div>
      </div>`}
    `;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          width: 100%;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          box-sizing: border-box;
        }
        
        * { box-sizing: border-box; }

        .layout {
          /* DEFAULT DARK THEME VARIABLES */
          --bg-main: #09090b;
          --bg-panel: #18181b;
          --bg-card: #18181b;
          --bg-element: #27272a;
          --bg-element-hover: #3f3f46;
          --border-light: #27272a;
          --border-heavy: #3f3f46;
          --text-title: #fafafa;
          --text-primary: #f4f4f5;
          --text-secondary: #a1a1aa;
          --text-muted: #52525b;
          --text-invert: #ffffff;
          --accent-blue: #3b82f6;
          --accent-blue-bg: rgba(59, 130, 246, 0.15);
          --accent-blue-border: rgba(59, 130, 246, 0.5);
          --accent-green: #10b981;
          --accent-green-bg: rgba(16, 185, 129, 0.15);
          --accent-purple: #8b5cf6;
          --accent-purple-bg: rgba(139, 92, 246, 0.15);
          --accent-red: #ef4444;

          display: flex;
          height: 100vh;
          overflow: hidden;
          width: 100%;
          background-color: var(--bg-main);
          color: var(--text-primary);
        }

        .layout.theme-light {
          /* PREMIUM LIGHT THEME VARIABLES */
          --bg-main: #f4f4f5;
          --bg-panel: #ffffff;
          --bg-card: #ffffff;
          --bg-element: #e4e4e7;
          --bg-element-hover: #d4d4d8;
          --border-light: #e4e4e7;
          --border-heavy: #d4d4d8;
          --text-title: #09090b;
          --text-primary: #18181b;
          --text-secondary: #52525b;
          --text-muted: #a1a1aa;
          --text-invert: #000000;
          --accent-blue-bg: rgba(59, 130, 246, 0.1);
          --accent-green-bg: rgba(16, 185, 129, 0.1);
        }

        /* DESKTOP LAYOUT */
        .sidebar {
          width: 340px;
          min-width: 340px;
          background-color: var(--bg-panel);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
        }

        .main-content {
          flex: 1;
          padding: 48px;
          overflow-y: auto;
          background-color: var(--bg-main);
        }

        .sidebar-header {
          padding: 24px 24px 16px 24px;
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-panel);
        }

        .sidebar-header h2 {
          margin: 0;
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-title);
          display: flex;
          align-items: center;
          gap: 12px;
          letter-spacing: 0.2px;
        }
        
        .sidebar-header svg { color: var(--accent-blue); }

        .menu-btn {
          background: none; border: none; color: var(--text-title); cursor: pointer; padding: 4px; margin-right: 8px;
          display: none; align-items: center; justify-content: center; border-radius: 8px; transition: background 0.2s;
        }
        .menu-btn:hover { background: var(--bg-element); }

        .mobile-back-btn {
          display: none; background: none; border: none; color: var(--accent-blue); font-size: 1rem; font-weight: 500;
          cursor: pointer; align-items: center; gap: 4px; padding: 0; margin-bottom: 16px;
        }
        .mobile-back-btn svg { width: 20px; height: 20px; }

        /* TOGGLE SWITCH */
        .filter-control {
          display: flex; align-items: center; justify-content: space-between; margin-top: 20px;
          background: var(--bg-main); padding: 10px 16px; border-radius: 12px; border: 1px solid var(--border-light);
        }
        .filter-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; transition: color 0.3s; }
        .filter-label.inactive { color: var(--text-muted); }
        .filter-label.active { color: var(--accent-green); }
        
        .toggle-switch { position: relative; display: inline-block; width: 48px; height: 26px; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }
        .toggle-slider {
          position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
          background-color: var(--border-heavy); transition: .3s; border-radius: 26px;
        }
        .toggle-slider:before {
          position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px;
          background-color: var(--text-invert); transition: .3s; border-radius: 50%;
        }
        input:checked + .toggle-slider { background-color: var(--accent-green); }
        input:checked + .toggle-slider:before { transform: translateX(22px); }

        /* TOOLBAR / SORT CONTROLS */
        .toolbar-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
        }
        .group-select-wrapper { flex-basis: 100%; }
        .sort-select-wrapper {
          flex: 1;
          position: relative;
        }
        .sort-select {
          width: 100%;
          appearance: none;
          -webkit-appearance: none;
          background: var(--bg-main);
          color: var(--text-primary);
          border: 1px solid var(--border-light);
          border-radius: 8px;
          padding: 8px 28px 8px 10px;
          font-size: 0.8rem;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          transition: border-color 0.2s, background-color 0.2s;
          outline: none;
        }
        .sort-select:hover {
          border-color: var(--border-heavy);
        }
        .sort-select:focus {
          border-color: var(--accent-blue);
        }
        .sort-select-wrapper::after {
          content: "";
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          width: 0;
          height: 0;
          pointer-events: none;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-top: 5px solid var(--text-secondary);
        }
        .control-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid var(--border-light);
          background: var(--bg-main);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s ease;
          padding: 0;
          flex-shrink: 0;
        }
        .control-btn:hover {
          background: var(--bg-element);
          color: var(--text-primary);
          border-color: var(--border-heavy);
        }
        .control-btn.active {
          background: var(--accent-blue-bg);
          color: var(--accent-blue);
          border-color: var(--accent-blue-border);
        }
        .flat-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .badge.deco-badge {
          color: var(--accent-blue);
          background: var(--accent-blue-bg);
          max-width: 130px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .device-list { flex: 1; overflow-y: auto; padding: 16px; }
        .device-list::-webkit-scrollbar { width: 6px; }
        .device-list::-webkit-scrollbar-thumb { background: var(--border-heavy); border-radius: 10px; }

        .deco-group { margin-bottom: 12px; background: var(--bg-element); border-radius: 12px; border: 1px solid var(--border-heavy); overflow: hidden; }
        .deco-group[open] { border-color: var(--text-muted); }
        .group-title {
          padding: 14px 16px; cursor: pointer; font-weight: 600; font-size: 0.95rem; color: var(--text-primary);
          display: flex; justify-content: space-between; align-items: center; background: var(--bg-element); list-style: none; user-select: none;
        }
        .group-title::-webkit-details-marker { display: none; }
        .group-title.active { background: var(--accent-blue-bg); }
        .group-header-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .group-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .group-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 8px; }
        .group-info-btn {
          display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0;
          border-radius: 6px; border: 1px solid transparent; background: none; color: var(--text-secondary); cursor: pointer; transition: all 0.2s;
        }
        .group-info-btn svg { width: 16px; height: 16px; }
        .group-info-btn:hover { background: var(--bg-panel); color: var(--text-primary); border-color: var(--border-heavy); }
        .group-info-btn.active { color: var(--accent-blue); border-color: var(--accent-blue-border); background: var(--accent-blue-bg); }
        .group-empty { padding: 10px 12px; font-size: 0.8rem; color: var(--text-muted); font-style: italic; }
        .role-badge {
          font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
          padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
        }
        .role-badge.main { color: var(--accent-green); background: var(--accent-green-bg); }
        .role-badge.satellite { color: var(--accent-purple); background: var(--accent-purple-bg); }
        .group-icon { width: 16px; height: 16px; color: var(--text-secondary); flex-shrink: 0; }
        .group-badge { background: var(--bg-panel); color: var(--text-secondary); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; }
        .group-content { padding: 8px; background: var(--bg-panel); border-top: 1px solid var(--border-heavy); }

        .device-item { padding: 12px; margin-bottom: 4px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; }
        .device-item:last-child { margin-bottom: 0; }
        .device-item:hover { background: var(--bg-element); }
        .device-item.active { background: var(--accent-blue-bg); border: 1px solid var(--accent-blue-border); }
        .device-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .status-dot.online { background-color: var(--accent-green); }
        .status-dot.offline { background-color: var(--text-muted); }
        .status-dot.deco-offline { background-color: var(--accent-red); }
        .status-dot { flex-shrink: 0; }
        .device-name { font-weight: 500; font-size: 0.9rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .device-meta { display: flex; gap: 8px; padding-left: 18px; }
        .badge {
          font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: var(--bg-element); color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .device-item.active .badge { background: var(--accent-blue-bg); color: var(--accent-blue); }

        .details-header { display: flex; flex-direction: column; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 1px solid var(--border-light); }
        .title-row { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; }
        .title-area { display: flex; align-items: center; gap: 16px; }
        
        .status-indicator { width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 4px rgba(0,0,0,0.05); }
        .theme-dark .status-indicator { box-shadow: 0 0 0 4px rgba(255,255,255,0.05); }
        .status-indicator.online { background-color: var(--accent-green); box-shadow: 0 0 0 4px var(--accent-green-bg); }
        .status-indicator.offline { background-color: var(--text-muted); }

        .details-header h1 { margin: 0; font-size: 2.2rem; font-weight: 700; color: var(--text-title); letter-spacing: -0.5px; }
        .status-badge { padding: 6px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; }
        .status-badge.online { background: var(--accent-green-bg); color: var(--accent-green); border: 1px solid var(--accent-green-bg); }
        .status-badge.offline { background: var(--bg-element); color: var(--text-secondary); border: 1px solid var(--border-heavy); }

        .cards-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 48px; }
        .info-card { background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 16px; padding: 24px; display: flex; align-items: flex-start; gap: 16px; transition: transform 0.2s, border-color 0.2s; }
        .info-card:hover { border-color: var(--border-heavy); transform: translateY(-2px); }
        .card-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--bg-element); display: flex; align-items: center; justify-content: center; color: var(--accent-blue); flex-shrink: 0; }
        .card-icon svg { width: 20px; height: 20px; }
        .card-label { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
        .card-value { font-size: 1.15rem; font-weight: 600; color: var(--text-title); word-break: break-all; }

        .bandwidth-section h2 { font-size: 1.25rem; color: var(--text-primary); margin-bottom: 24px; font-weight: 600; }
        .bw-card { background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
        .bw-header { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; font-weight: 600; color: var(--text-secondary); }
        .bw-header svg { width: 20px; height: 20px; }
        .bw-card.down .bw-header svg { color: var(--accent-blue); }
        .bw-card.up .bw-header svg { color: var(--accent-purple); }
        .bw-value { font-size: 2.2rem; font-weight: 700; color: var(--text-title); }
        .bw-value .unit { font-size: 1rem; color: var(--text-muted); font-weight: 500; }

        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 1.15rem; font-weight: 500; }

        /* COPY TO CLIPBOARD BUTTONS */
        .copy-container { display: flex; align-items: center; gap: 8px; }
        .copy-btn {
          background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 6px; 
          display: flex; align-items: center; justify-content: center; transition: all 0.2s; opacity: 0.3;
        }
        @media (hover: hover) { .copy-container:hover .copy-btn { opacity: 1; } }
        @media (hover: none) { .copy-btn { opacity: 0.8; } }
        .copy-btn:hover { background: var(--bg-element); color: var(--text-primary); }
        .copy-btn svg { width: 16px; height: 16px; }
        .details-header .copy-btn svg { width: 20px; height: 20px; }

        /* MOBILE DRILL-DOWN NAVIGATION */
        @media (max-width: 768px) {
          .menu-btn { display: flex; }
          .mobile-back-btn { display: flex; }
          .layout.mobile-view-list .sidebar { display: flex; width: 100%; height: 100vh; }
          .layout.mobile-view-list .main-content { display: none; }
          .layout.mobile-view-details .sidebar { display: none; }
          .layout.mobile-view-details .main-content { display: block; width: 100%; height: 100vh; padding: 24px 16px; }
          .title-row { flex-direction: column; align-items: flex-start; gap: 12px; }
          .details-header { margin-bottom: 24px; padding-bottom: 16px; }
          .details-header h1 { font-size: 1.8rem; }
          .cards-container { grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
          .info-card { padding: 16px; flex-direction: column; gap: 10px; }
          .card-value { font-size: 1rem; }
          .bw-card { padding: 16px; gap: 12px; }
          .bw-value { font-size: 1.6rem; }
        }
      </style>
      
      <div class="layout theme-dark mobile-view-${this.mobileView}">
        <div class="sidebar">
          <div class="sidebar-header">
            <h2>
              <button id="ha-menu-btn" class="menu-btn" aria-label="Menu">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              </button>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
              Deco Network
            </h2>
            <div class="filter-control">
              <span class="filter-label inactive" id="lbl-off">Disconnected</span>
              <label class="toggle-switch">
                <input type="checkbox" id="connection-filter" ${this.showConnected ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <span class="filter-label active" id="lbl-on">Connected</span>
            </div>

            <div class="toolbar-controls">
              <div class="sort-select-wrapper">
                <select id="sort-select" class="sort-select" aria-label="Sort devices by">
                  <option value="name" ${this.sortBy === 'name' ? 'selected' : ''}>Sort: Name</option>
                  <option value="ip" ${this.sortBy === 'ip' ? 'selected' : ''}>Sort: IP Address</option>
                  <option value="mac" ${this.sortBy === 'mac' ? 'selected' : ''}>Sort: MAC Address</option>
                </select>
              </div>
              <button id="sort-dir-btn" class="control-btn" title="Sort order" aria-label="Toggle sort order">
              </button>
              <div class="sort-select-wrapper group-select-wrapper">
                <select id="group-select" class="sort-select" aria-label="Group devices by">
                  <option value="deco" ${this.groupMode === 'deco' ? 'selected' : ''}>Group: By Deco</option>
                  <option value="split" ${this.groupMode === 'split' ? 'selected' : ''}>Group: Decos &amp; Devices</option>
                  <option value="flat" ${this.groupMode === 'flat' ? 'selected' : ''}>Group: None (flat)</option>
                </select>
              </div>
            </div>
          </div>
          <div class="device-list" id="device-list">
            <!-- List goes here -->
          </div>
        </div>
        <div class="main-content" id="device-details">
          <!-- Details go here -->
        </div>
      </div>
    `;

    const toggle = this.shadowRoot.getElementById('connection-filter');
    const lblOff = this.shadowRoot.getElementById('lbl-off');
    const lblOn = this.shadowRoot.getElementById('lbl-on');
    const menuBtn = this.shadowRoot.getElementById('ha-menu-btn');
    const sortSelect = this.shadowRoot.getElementById('sort-select');
    const sortDirBtn = this.shadowRoot.getElementById('sort-dir-btn');
    const groupSelect = this.shadowRoot.getElementById('group-select');

    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true }));
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.sortBy = e.target.value;
        this.updateUI();
      });
    }

    if (sortDirBtn) {
      sortDirBtn.addEventListener('click', () => {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        this.updateUI();
      });
    }

    if (groupSelect) {
      groupSelect.addEventListener('change', (e) => {
        if (!GROUP_MODES.includes(e.target.value)) return;
        this.groupMode = e.target.value;
        this.saveGroupMode();
        this.updateUI();
      });
    }

    toggle.addEventListener('change', (e) => {
      this.showConnected = e.target.checked;
      if (this.showConnected) {
        lblOn.classList.add('active');
        lblOn.classList.remove('inactive');
        lblOff.classList.remove('active');
        lblOff.classList.add('inactive');
      } else {
        lblOff.classList.add('active');
        lblOff.classList.remove('inactive');
        lblOn.classList.remove('active');
        lblOn.classList.add('inactive');
      }
      this.selectedMac = null;
      this.mobileView = 'list';
      this.processData();
      this.updateUI();
    });

    if (this.showConnected) {
      lblOn.classList.add('active');
      lblOn.classList.remove('inactive');
      lblOff.classList.remove('active');
      lblOff.classList.add('inactive');
    } else {
      lblOff.classList.add('active');
      lblOff.classList.remove('inactive');
      lblOn.classList.remove('active');
      lblOn.classList.add('inactive');
    }

    this.updateUI();
  }
}

customElements.define('deco-dashboard', DecoDashboard);
