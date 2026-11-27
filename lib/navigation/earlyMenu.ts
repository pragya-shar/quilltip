/**
 * Before the page scripts run, the mobile menu is a popover
 * (components/layout/AppMobileMenu.tsx). Unlike the modal dialog the scripts
 * open, a popover lets Tab move on to the page behind the sheet. This inline
 * script closes it when focus leaves it, so focus never lands on a link the
 * sheet covers. Once the scripts run, the menu opens as a modal dialog and
 * this never applies.
 */
export const EARLY_MENU_SCRIPT = `document.addEventListener("focusin",function(e){try{var m=document.querySelector(".app-mobile-menu:popover-open"),t=e.target;if(m&&t instanceof Element&&!m.contains(t)&&!t.closest("[popovertarget]"))m.hidePopover()}catch(x){}},true)`
