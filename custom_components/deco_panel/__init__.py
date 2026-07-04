import logging
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components import panel_custom
from homeassistant.components import frontend

from .const import DOMAIN, PANEL_NAME, PANEL_TITLE, PANEL_ICON

from homeassistant.components.http import StaticPathConfig

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up Deco Panel from a config entry."""
    
    # Register the static path for the frontend file
    frontend_path = hass.config.path(f"custom_components/{DOMAIN}/frontend")
    await hass.http.async_register_static_paths([
        StaticPathConfig("/deco_panel_static", frontend_path, cache_headers=False)
    ])
    
    # Register the custom panel
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_NAME,
        webcomponent_name="deco-dashboard",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url="/deco_panel_static/deco-dashboard.js",
        config={},
        require_admin=False
    )

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload a config entry."""
    frontend.async_remove_panel(hass, PANEL_NAME)
    return True
