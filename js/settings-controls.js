/* Unavailable Settings actions explain themselves on touch and to assistive technology. */
function setButtonUnavailable(button, reason = '') {
  button.disabled = Boolean(reason);
  if (reason) {
    button.dataset.unavailable = reason;
    button.setAttribute('aria-description', reason);
  } else {
    delete button.dataset.unavailable;
    button.removeAttribute('aria-description');
  }
}
