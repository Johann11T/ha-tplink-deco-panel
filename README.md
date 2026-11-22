# TP-Link Deco Panel for Home Assistant

A beautiful and modern dashboard panel for your TP-Link Deco network in Home Assistant.

**Note:** This is a **companion** integration. It requires the [ha-tplink-deco](https://github.com/amosyuen/ha-tplink-deco) integration to be installed and running in your Home Assistant, as it uses the data provided by it.

## Features
- 🎨 **Premium UI:** Modern, dark-themed, glassmorphism design.
- 📱 **Mobile Master-Detail Navigation:** iOS-style drill-down navigation for perfect viewing on phones.
- 🎛️ **Live Filtering:** Filter between connected and disconnected devices.
- ⚡ **Real-time Stats:** Live view of upload/download bandwidth, connection type, IP, and MAC address.
- 📋 **Copy to Clipboard:** 1-click copying of device data for easy network management.
- 🔄 **Advanced Sorting & Grouping:** Sort devices by Name, IP Address, or MAC Address (Asc/Desc), and group them **By Deco**, as **Decos & Devices**, or as a flat list. Your choice is remembered.
- 🛰️ **Mesh-aware:** Every Deco is labeled **Main** or **Satellite**, offline Decos are highlighted, and each Deco's details (role, model, firmware) are one click away.

## Installation via the Home Assistant Marketplace (Recommended)

Starting with Home Assistant 2026.11, HACS is built into Home Assistant as the **Marketplace**. If you are on an older version, you can still install this integration through [HACS](https://hacs.xyz/) using the same steps (search for "TP-Link Deco Panel" in the **Integrations** tab).

1. Make sure the [ha-tplink-deco](https://github.com/amosyuen/ha-tplink-deco) integration is installed and configured.
2. In Home Assistant, go to **Settings > Marketplace**. (The first time, accept the community-content warning.)
3. Search for "TP-Link Deco Panel" and open it.
4. Select **Install**.
5. **Restart Home Assistant** if the Marketplace asks you to.
6. Go to **Settings > Devices & Services**.
7. Click **Add Integration** and search for "TP-Link Deco Panel".
8. Click it to set it up automatically. Your sidebar will immediately update with the new panel!
