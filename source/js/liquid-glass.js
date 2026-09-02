(() => {
  const controlSelector = [
    '#nav > #menus > .menus_items > .menus_item > a.site-page:not(.child)',
    '#nav #search-button > a.site-page',
    '#nav #toggle-menu a.site-page',
    '#rightside > div > button',
    '#rightside > div > a',
    '#pagination:not(.pagination-post) .pagination > *:not(.space)',
    '#site_social_icons > a.social-icon',
    '.card-info-social-icons > a.social-icon'
  ].join(',')

  const updateHighlight = (control, event) => {
    const bounds = control.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 100
    const y = ((event.clientY - bounds.top) / bounds.height) * 100

    control.style.setProperty('--liquid-x', `${x.toFixed(1)}%`)
    control.style.setProperty('--liquid-y', `${y.toFixed(1)}%`)
  }

  const resetHighlight = control => {
    control.style.removeProperty('--liquid-x')
    control.style.removeProperty('--liquid-y')
  }

  const enhanceControls = () => {
    document.querySelectorAll(controlSelector).forEach(control => {
      control.classList.add('liquid-glass-control')

      if (control.dataset.liquidGlassReady === 'true') return

      control.dataset.liquidGlassReady = 'true'
      control.addEventListener('pointermove', event => updateHighlight(control, event))
      control.addEventListener('pointerleave', () => resetHighlight(control))
      control.addEventListener('pointercancel', () => resetHighlight(control))
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceControls, { once: true })
  } else {
    enhanceControls()
  }

  document.addEventListener('pjax:complete', enhanceControls)
})()
