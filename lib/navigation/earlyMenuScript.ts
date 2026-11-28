import { EARLY_MENU_PROPERTY } from './earlyMenu'

/**
 * The inline script described in lib/navigation/earlyMenu.ts. Its own module,
 * so only the root layout (a server component) imports the text and the
 * client bundle does not carry it.
 */
export const EARLY_MENU_SCRIPT = `(function(){var p="${EARLY_MENU_PROPERTY}";document.addEventListener("focusin",function(e){try{var m=document.querySelector(".app-mobile-menu:popover-open"),t=e.target;if(m&&t instanceof Element&&!m.contains(t)&&!t.closest("[popovertarget]"))m.hidePopover()}catch(x){}},true);document.addEventListener("toggle",function(e){var t=e.target;if(self[p]!=="done"&&t instanceof Element&&t.classList.contains("app-mobile-menu"))self[p]=e.newState},true)})()`
