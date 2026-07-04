class DecoDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this.devices = [];
    this.selectedMac = null;
    this.rendered = false;
    this.showConnected = true;
    this.groupOpenStates = {};
    
    // For mobile drill-down navigation ('list' or 'details')
    this.mobileView = 'list';
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
    const trackers = allStates.filter(state => 
      state.entity_id && 
      state.entity_id.startsWith('device_tracker.') && 
      state.attributes &&
      state.attributes.mac && 
      state.attributes.ip
    );

    this.devices = trackers.map(state => {
      let name = state.attributes.ui_device_name || state.attributes.friendly_name || state.entity_id;
      return {
        entity_id: state.entity_id,
        name: String(name),
        mac: state.attributes.mac,
        ip: state.attributes.ip,
        state: state.state,
        down: state.attributes.down_kilobytes_per_s || 0,
        up: state.attributes.up_kilobytes_per_s || 0,
        connection: state.attributes.connection_type || 'Unknown',
        deco: state.attributes.deco_device ? state.attributes.deco_device : (state.attributes.device_type === 'deco' ? 'Deco Routers' : 'Unknown Deco')
      };
    }).sort((a, b) => {
      return a.name.localeCompare(b.name);
    });

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

    const listContainer = this.shadowRoot.getElementById('device-list');
    const detailsContainer = this.shadowRoot.getElementById('device-details');
    
    if (listContainer) {
      const detailsEls = listContainer.querySelectorAll('details.deco-group');
      detailsEls.forEach(el => {
        this.groupOpenStates[el.dataset.deco] = el.open;
      });
    }

    const filteredDevices = this.devices.filter(d => 
      this.showConnected ? d.state === 'home' : d.state !== 'home'
    );

    const groups = {};
    filteredDevices.forEach(device => {
      if (!groups[device.deco]) groups[device.deco] = [];
      groups[device.deco].push(device);
    });
    
    if (listContainer) {
      if (filteredDevices.length > 0) {
        let html = '';
        for (const [decoName, devicesInGroup] of Object.entries(groups)) {
          let isOpen = this.groupOpenStates[decoName];
          if (isOpen === undefined) {
             isOpen = devicesInGroup.some(d => d.mac === this.selectedMac);
          }
          const safeDecoName = this.escapeHtml(decoName);
          html += `
            <details class="deco-group" data-deco="${safeDecoName}" ${isOpen ? 'open' : ''}>
              <summary class="group-title">
                <div class="group-header-info">
                  <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
                  ${safeDecoName}
                </div>
                <span class="group-badge">${devicesInGroup.length}</span>
              </summary>
              <div class="group-content">
                ${devicesInGroup.map(device => this.getDeviceHtml(device)).join('')}
              </div>
            </details>
          `;
        }
        listContainer.innerHTML = html;
        
        const items = listContainer.querySelectorAll('.device-item');
        items.forEach(item => {
          item.addEventListener('click', (e) => {
            this.selectedMac = e.currentTarget.dataset.mac;
            this.mobileView = 'details'; // Navigate to details on mobile
            this.updateUI();
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

  getDeviceHtml(device) {
    const isSelected = device.mac === this.selectedMac;
    const isConnected = device.state === 'home';
    const safeName = this.escapeHtml(device.name);
    const safeMac = this.escapeHtml(device.mac);
    const safeIp = this.escapeHtml(device.ip);
    
    return `
      <div class="device-item ${isSelected ? 'active' : ''}" data-mac="${safeMac}">
        <div class="device-header">
          <div class="status-dot ${isConnected ? 'online' : 'offline'}"></div>
          <div class="device-name">${safeName}</div>
        </div>
        <div class="device-meta">
          <span class="badge">${safeIp}</span>
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
    const safeDeco = this.escapeHtml(device.deco);
    const safeConnType = this.escapeHtml(connType);

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

        <div class="info-card">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
          </div>
          <div class="card-content">
            <div class="card-label">Parent Deco Node</div>
            <div class="card-value">${safeDeco}</div>
          </div>
        </div>
      </div>

      <div class="bandwidth-section">
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
      </div>
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
        .group-header-info { display: flex; align-items: center; gap: 8px; }
        .group-icon { width: 16px; height: 16px; color: var(--text-secondary); }
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

    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true }));
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
