(() => {
  'use strict'

  if (window.palpitateLiquidGlass) {
    window.palpitateLiquidGlass.refresh()
    return
  }

  const selector = [
    '#nav > #menus > .menus_items > .menus_item > a.site-page:not(.child)',
    '#nav #search-button > a.site-page',
    '#nav #toggle-menu a.site-page',
    '#rightside > div > button',
    '#rightside > div > a',
    '#pagination:not(.pagination-post) .pagination > *:not(.space)',
    '#site_social_icons > a.social-icon',
    '.card-info-social-icons > a.social-icon'
  ].join(',')
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const transparency = matchMedia('(prefers-reduced-transparency: reduce)')
  const contrast = matchMedia('(prefers-contrast: more)')
  const chromium = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/EdgiOS|CriOS/.test(navigator.userAgent)
  const supportsLens = chromium && CSS.supports('backdrop-filter', 'url("#lg-lens")')
  const svgNS = 'http://www.w3.org/2000/svg'
  const controls = new Map()
  const active = new Set()
  const surfaces = new Map()
  const lensCache = new Map()
  let definitions
  let filterIndex = 0
  let frame = 0
  let lastTime = 0
  let toolbar

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
  const make = (tag, attrs) => {
    const node = document.createElementNS(svgNS, tag)
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value))
    return node
  }
  const channel = value => ({ value, velocity: 0, target: value })
  const step = (state, dt, stiffness = 250, damping = 23) => {
    state.velocity += (stiffness * (state.target - state.value) - damping * state.velocity) * dt
    state.value += state.velocity * dt
    if (Math.abs(state.target - state.value) < .001 && Math.abs(state.velocity) < .005) {
      state.value = state.target
      state.velocity = 0
      return false
    }
    return true
  }

  // Encode the normal of a rounded lens into an RG displacement map. Only the
  // curved perimeter refracts; the flat center preserves the underlying content.
  const displacementMap = (width, height) => {
    const key = width + 'x' + height
    if (lensCache.has(key)) return lensCache.get(key)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    const pixels = context.createImageData(width, height)
    const radius = Math.min(width, height) / 2
    const edge = Math.min(12, radius * .55)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x + .5 - width / 2
        const py = y + .5 - height / 2
        const qx = Math.abs(px) - (width / 2 - radius)
        const qy = Math.abs(py) - (height / 2 - radius)
        const ax = Math.max(qx, 0)
        const ay = Math.max(qy, 0)
        const outside = Math.hypot(ax, ay)
        const distance = outside + Math.min(Math.max(qx, qy), 0) - radius
        const depth = clamp(-distance / edge, 0, 1)
        const bend = distance <= 0 ? Math.sin(depth * Math.PI) : 0
        const nx = outside > 0 ? Math.sign(px) * ax / outside : (qx > qy ? Math.sign(px) : 0)
        const ny = outside > 0 ? Math.sign(py) * ay / outside : (qy >= qx ? Math.sign(py) : 0)
        const i = (y * width + x) * 4
        pixels.data[i] = Math.round(127.5 + nx * bend * 127)
        pixels.data[i + 1] = Math.round(127.5 + ny * bend * 127)
        pixels.data[i + 2] = 128
        pixels.data[i + 3] = 255
      }
    }
    context.putImageData(pixels, 0, 0)
    const image = canvas.toDataURL()
    lensCache.set(key, image)
    if (lensCache.size > 48) lensCache.delete(lensCache.keys().next().value)
    return image
  }

  const updateLens = (surface, entry) => {
    if (!surface.isConnected) {
      entry.filter.remove()
      surfaces.delete(surface)
      resizeObserver.unobserve(surface)
      return
    }
    const enabled = supportsLens && !transparency.matches && !contrast.matches
    if (!enabled) {
      entry.optics.style.removeProperty('backdrop-filter')
      return
    }
    // offset dimensions are stable while a control tilts or stretches.
    const width = Math.max(1, Math.round(surface.offsetWidth))
    const height = Math.max(1, Math.round(surface.offsetHeight))
    if (width === 1 || height === 1) return
    const size = width + 'x' + height
    if (entry.size !== size) {
      const map = displacementMap(width, height)
      if (!map) return
      entry.image.setAttribute('href', map)
      entry.image.setAttribute('width', width)
      entry.image.setAttribute('height', height)
      entry.size = size
    }
    entry.optics.style.backdropFilter = 'url("#' + entry.id + '") blur(2px) saturate(1.35)'
  }

  const resizeObserver = new ResizeObserver(entries => {
    entries.forEach(({ target }) => {
      const entry = surfaces.get(target)
      // The toolbar updates its map at the end of its spring, not every frame.
      if (entry && !(toolbar && target === toolbar.surface && toolbar.animating)) {
        updateLens(target, entry)
      }
    })
  })

  const addSurface = surface => {
    const optics = document.createElement('span')
    optics.className = 'lg-optics'
    optics.setAttribute('aria-hidden', 'true')
    surface.prepend(optics)
    if (!supportsLens) return
    if (!definitions) {
      const svg = make('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' })
      svg.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden'
      definitions = make('defs')
      svg.append(definitions)
      document.body.append(svg)
    }
    const id = 'palpitate-lg-lens-' + (++filterIndex)
    const filter = make('filter', {
      id, x: '0%', y: '0%', width: '100%', height: '100%',
      'color-interpolation-filters': 'sRGB'
    })
    const image = make('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'lens' })
    filter.append(image, make('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'lens', scale: 14,
      xChannelSelector: 'R', yChannelSelector: 'G'
    }))
    definitions.append(filter)
    const entry = { id, filter, image, optics }
    surfaces.set(surface, entry)
    updateLens(surface, entry)
    resizeObserver.observe(surface)
  }

  const renderControl = state => {
    const style = state.element.style
    const light = clamp(state.light.value, 0, 1)
    const press = clamp(state.press.value, 0, 1)
    const scale = state.scale.value
    style.setProperty('--lg-x', state.x.value.toFixed(2) + '%')
    style.setProperty('--lg-y', state.y.value.toFixed(2) + '%')
    style.setProperty('--lg-angle', (-35 + (state.x.value - 50) * .8).toFixed(2) + 'deg')
    style.setProperty('--lg-light', light.toFixed(3))
    style.setProperty('--lg-press', press.toFixed(3))
    style.setProperty('--lg-tx', state.tx.value.toFixed(3) + 'px')
    style.setProperty('--lg-ty', state.ty.value.toFixed(3) + 'px')
    style.setProperty('--lg-sx', (scale + press * .025).toFixed(4))
    style.setProperty('--lg-sy', (scale - press * .025).toFixed(4))
    style.setProperty('--lg-rx', state.rx.value.toFixed(2) + 'deg')
    style.setProperty('--lg-ry', state.ry.value.toFixed(2) + 'deg')
  }

  const tick = time => {
    const dt = Math.min((time - (lastTime || time - 16)) / 1000, .032)
    lastTime = time
    active.forEach(state => {
      let moving = false
      Object.entries(state).forEach(([key, value]) => {
        if (!value || typeof value.target !== 'number') return
        moving = step(value, dt, key === 'scale' ? 320 : 250, key === 'scale' ? 21 : 23) || moving
      })
      renderControl(state)
      if (!moving) active.delete(state)
    })
    if (toolbar && toolbar.animating) {
      const moving = step(toolbar.height, dt, 210, 22)
      const opening = step(toolbar.expand, dt, 230, 25)
      toolbar.element.style.setProperty('--lg-toolbar-height', toolbar.height.value.toFixed(2) + 'px')
      toolbar.element.style.setProperty('--lg-expand', clamp(toolbar.expand.value, 0, 1).toFixed(3))
      toolbar.element.style.setProperty('--lg-shell-scale', (1 + clamp(toolbar.height.velocity / 14000, -.035, .035)).toFixed(4))
      toolbar.animating = moving || opening
      if (!toolbar.animating) {
        toolbar.element.style.removeProperty('--lg-shell-scale')
        const entry = surfaces.get(toolbar.surface)
        if (entry) updateLens(toolbar.surface, entry)
      }
    }
    if (active.size || (toolbar && toolbar.animating)) {
      frame = requestAnimationFrame(tick)
    } else {
      frame = 0
      lastTime = 0
    }
  }

  const schedule = state => {
    if (motion.matches) {
      if (state) {
        Object.values(state).forEach(value => {
          if (value && typeof value.target === 'number') {
            value.value = value.target
            value.velocity = 0
          }
        })
        renderControl(state)
      }
      if (toolbar) {
        toolbar.height.value = toolbar.height.target
        toolbar.height.velocity = 0
        toolbar.expand.value = toolbar.expand.target
        toolbar.expand.velocity = 0
        toolbar.animating = false
        toolbar.element.style.setProperty('--lg-toolbar-height', toolbar.height.value + 'px')
        toolbar.element.style.setProperty('--lg-expand', toolbar.expand.value)
      }
      return
    }
    if (state) active.add(state)
    if (!frame) frame = requestAnimationFrame(tick)
  }

  const release = state => {
    state.pressed = false
    state.press.target = 0
    state.scale.target = state.hovered ? 1.045 : 1
    if (!state.hovered) {
      state.tx.target = state.ty.target = state.rx.target = state.ry.target = 0
      state.light.target = 0
      state.x.target = 30
      state.y.target = 15
    }
    schedule(state)
  }

  const enhance = element => {
    if (controls.has(element)) return
    element.classList.add('liquid-glass-control')
    const inToolbar = Boolean(element.closest('#rightside'))
    if (!inToolbar) addSurface(element)
    const state = {
      element, hovered: false, pressed: false,
      x: channel(30), y: channel(15), light: channel(0), press: channel(0),
      tx: channel(0), ty: channel(0), rx: channel(0), ry: channel(0), scale: channel(1)
    }
    controls.set(element, state)
    if (element.title && !element.getAttribute('aria-label')) element.setAttribute('aria-label', element.title)
    const interactive = element.matches('button, a[href]')
    if (!interactive) {
      element.setAttribute('aria-current', 'page')
      return
    }
    const move = event => {
      const bounds = element.getBoundingClientRect()
      const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1)
      const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
      state.x.target = x * 100
      state.y.target = y * 100
      if (!motion.matches && event.pointerType !== 'touch') {
        state.tx.target = (x - .5) * 4
        state.ty.target = (y - .5) * 4
        state.rx.target = (.5 - y) * 5
        state.ry.target = (x - .5) * 5
      }
      if (inToolbar && toolbar) {
        const box = toolbar.element.getBoundingClientRect()
        toolbar.surface.style.setProperty('--lg-x', ((event.clientX - box.left) / box.width * 100) + '%')
        toolbar.surface.style.setProperty('--lg-y', ((event.clientY - box.top) / box.height * 100) + '%')
      }
      schedule(state)
    }
    element.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return
      state.hovered = true
      state.light.target = .8
      state.scale.target = 1.045
      move(event)
      if (inToolbar && toolbar) toolbar.surface.style.setProperty('--lg-light', '.45')
    })
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', () => {
      state.hovered = false
      release(state)
      if (inToolbar && toolbar) toolbar.surface.style.setProperty('--lg-light', '0')
    })
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      state.pressed = true
      state.press.target = 1
      state.light.target = 1
      state.scale.target = .94
      move(event)
    })
    element.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') {
        state.pressed = true
        state.press.target = 1
        state.light.target = 1
        state.scale.target = .94
        schedule(state)
      }
    })
    element.addEventListener('keyup', () => release(state))
    element.addEventListener('blur', () => release(state))
  }

  const groupHeight = group => {
    const visible = [...group.children].filter(child => getComputedStyle(child).display !== 'none')
    return visible.length * 44 + Math.max(visible.length - 1, 0) * 4
  }

  const syncToolbar = (initial = false) => {
    if (!toolbar) return
    const { element, hidden, shown, setting } = toolbar
    const expanded = hidden.classList.contains('show')
    const mainHeight = groupHeight(shown)
    const hideHeight = groupHeight(hidden)
    element.style.setProperty('--lg-main-height', mainHeight + 'px')
    element.classList.toggle('lg-expanded', expanded)
    hidden.inert = !expanded
    hidden.setAttribute('aria-hidden', String(!expanded))
    if (setting) setting.setAttribute('aria-expanded', String(expanded))
    toolbar.height.target = 12 + mainHeight + (expanded && hideHeight ? hideHeight + 4 : 0)
    toolbar.expand.target = expanded ? 1 : 0
    if (initial || motion.matches) {
      toolbar.height.value = toolbar.height.target
      toolbar.expand.value = toolbar.expand.target
      element.style.setProperty('--lg-toolbar-height', toolbar.height.value + 'px')
      element.style.setProperty('--lg-expand', toolbar.expand.value)
      const entry = surfaces.get(toolbar.surface)
      if (entry) updateLens(toolbar.surface, entry)
    } else {
      toolbar.animating = true
      schedule()
    }
  }

  const enhanceToolbar = () => {
    const element = document.getElementById('rightside')
    if (!element) return
    const hidden = document.getElementById('rightside-config-hide')
    const shown = document.getElementById('rightside-config-show')
    if (!hidden || !shown) return
    if (toolbar) toolbar.observer.disconnect()
    const setting = document.getElementById('rightside-config')
    const surface = element.querySelector('.lg-toolbar-surface') || document.createElement('span')
    surface.className = 'lg-toolbar-surface'
    surface.setAttribute('aria-hidden', 'true')
    // Keep the hidden group first: Butterfly's settings handler relies on it.
    element.append(surface)
    element.classList.add('lg-toolbar')
    toolbar = { element, hidden, shown, setting, surface,
      height: channel(104), expand: channel(0), animating: false }
    element.setAttribute('role', 'group')
    element.setAttribute('aria-label', '页面快捷工具')
    if (setting) setting.setAttribute('aria-controls', hidden.id)
    if (!surface.querySelector('.lg-optics')) addSurface(surface)
    // Off-screen controls must not remain in the keyboard focus order.
    const syncVisibility = () => {
      element.inert = !element.classList.contains('rightside-show')
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target === hidden)) syncToolbar()
      syncVisibility()
    })
    observer.observe(hidden, { attributes: true, attributeFilter: ['class'] })
    observer.observe(element, { attributes: true, attributeFilter: ['class'] })
    toolbar.observer = observer
    syncToolbar(true)
    syncVisibility()
  }

  const syncTheme = () => {
    const dark = document.getElementById('darkmode')
    if (dark) dark.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'))
  }

  const refresh = () => {
    controls.forEach((state, element) => {
      if (!element.isConnected) {
        controls.delete(element)
        active.delete(state)
      }
    })
    surfaces.forEach((entry, surface) => {
      if (!surface.isConnected) {
        entry.filter.remove()
        resizeObserver.unobserve(surface)
        surfaces.delete(surface)
      }
    })
    document.querySelectorAll(selector).forEach(enhance)
    enhanceToolbar()
    syncTheme()
  }

  const releaseAll = () => controls.forEach(state => {
    if (state.pressed) release(state)
  })
  document.addEventListener('pointerup', releaseAll)
  document.addEventListener('pointercancel', releaseAll)
  window.addEventListener('blur', releaseAll)
  window.addEventListener('resize', () => syncToolbar())
  document.addEventListener('pjax:complete', refresh)
  const themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  const preferencesChanged = () => {
    if (motion.matches) {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      lastTime = 0
      controls.forEach(state => schedule(state))
      active.clear()
      if (toolbar) {
        toolbar.element.style.removeProperty('--lg-shell-scale')
        syncToolbar(true)
      }
    }
    surfaces.forEach((entry, surface) => updateLens(surface, entry))
  }
  ;[motion, transparency, contrast].forEach(preference => preference.addEventListener('change', preferencesChanged))
  window.palpitateLiquidGlass = { refresh }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once: true })
  } else {
    refresh()
  }
})()
