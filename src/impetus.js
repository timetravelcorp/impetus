const STOP_THRESHOLD_DEFAULT = 0.3;
const BOUNCE_DECELERATION = 0.04;
const BOUNCE_ACCELERATION = 0.11;

// fixes weird safari 10 bug where preventDefault is prevented
// @see https://github.com/metafizzy/flickity/issues/457#issuecomment-254501356
if (typeof window !== 'undefined') {
  window.addEventListener('touchmove', () => {});
}

/**
 * Creates a custom normalized event object from touch and mouse events
 * @param  {Event} ev
 * @returns {Object} with x, y, and id properties
 */
function normalizeEvent(ev) {
  if (
    ev.type === 'touchmove' ||
    ev.type === 'touchstart' ||
    ev.type === 'touchend'
  ) {
    const [touch] = ev.changedTouches;

    return {
      x: touch.clientX,
      y: touch.clientY,
      id: touch.identifier,
    };
  }

  // mouse events
  return {
    x: ev.clientX,
    y: ev.clientY,
    id: null,
  };
}

/**
 * Returns a value from around 0.5 to 1, based on distance
 * @param {Number} val
 */
const dragOutOfBoundsMultiplier = val => (
  (0.000005 * (val ** 2)) + (0.0001 * val) + 0.55
);

export default class Impetus {
  constructor({
    source: baseSourceEl = document,
    update: updateCallback,
    multiplier = 1,
    friction = 0.92,
    bounce = true,
    boundX,
    boundY,
    initialValues,
    onDown,
    onUp,
  }) {
    this.updateCallback = updateCallback;
    this.stepDecelRaf = null;
    this.tickRaf = null;
    this.options = {
      bounce,
      friction,
      multiplier,
      onDown,
      onUp,
      stopThreshold: STOP_THRESHOLD_DEFAULT * multiplier,
      targetX: 0,
      targetY: 0,
      paused: false,
      ticking: false,
      decelerating: false,
      pointerActive: false,
      trackingPoints: [],
      pointerCurrentX: null,
      pointerCurrentY: null,
      pointerLastX: null,
      pointerLastY: null,
      boundXmin: null,
      boundXmax: null,
      boundYmin: null,
      boundYmax: null,
      pointerId: null,
      decVelX: null,
      decVelY: null,
    };

    let passiveSupported = true;

    try {
      const options = Object.defineProperty({}, 'passive', {
        get() {
          return true;
        },
      });

      window.addEventListener('test', null, options);
    } catch (err) {
      passiveSupported = false;
    }

    this.eventOptions = passiveSupported ? { passive: false } : false;
    this.sourceEl = typeof baseSourceEl === 'string'
      ? document.querySelector(baseSourceEl)
      : baseSourceEl;

    if (!this.sourceEl) {
      throw new Error('IMPETUS: source not found.');
    }

    if (!this.updateCallback) {
      throw new Error('IMPETUS: update function not defined.');
    }

    if (initialValues) {
      const [targetX, targetY] = initialValues;

      if (targetX) {
        this.options.targetX = targetX;
      }

      if (targetY) {
        this.options.targetY = targetY;
      }

      this.callUpdateCallback();
    }

    // Initialize bound values
    if (boundX) {
      const [
        boundXmin,
        boundXmax,
      ] = boundX;

      this.options.boundXmin = boundXmin;
      this.options.boundXmax = boundXmax;
    }

    if (boundY) {
      const [
        boundYmin,
        boundYmax,
      ] = boundY;

      this.options.boundYmin = boundYmin;
      this.options.boundYmax = boundYmax;
    }

    this.sourceEl.addEventListener('touchstart', this.onDown);
    this.sourceEl.addEventListener('mousedown', this.onDown);
    window.addEventListener('wheel', this.onWheel, this.eventOptions);
  }

  /**
   * Executes the update function
   */
  callUpdateCallback = () => this.updateCallback(this.options);

  /**
   * Initialize animation of values coming to a stop
   */
  startDecelAnim = () => {
    const {
      multiplier,
      trackingPoints,
    } = this.options;

    const [firstPoint] = trackingPoints;
    const lastPoint = trackingPoints[trackingPoints.length - 1];
    const xOffset = lastPoint.x - firstPoint.x;
    const yOffset = lastPoint.y - firstPoint.y;
    const timeOffset = lastPoint.time - firstPoint.time;
    const D = (timeOffset / 15) / multiplier;

    this.options.decVelX = (xOffset / D) || 0; // prevent NaN
    this.options.decVelY = (yOffset / D) || 0;

    const diff = this.checkBounds();

    if (
      Math.abs(this.options.decVelX) > 1 ||
      Math.abs(this.options.decVelY) > 1 ||
      !diff.inBounds
    ) {
      this.options.decelerating = true;
      this.stepDecelRaf = requestAnimationFrame(this.stepDecelAnim);
    }
  }

  /**
   * Animates values slowing down
   */
  stepDecelAnim = () => {
    this.stepDecelRaf = null;

    const {
      bounce,
      decelerating,
      friction,
      stopThreshold,
    } = this.options;

    if (!decelerating) {
      return;
    }

    this.options.decVelX *= friction;
    this.options.decVelY *= friction;
    this.options.targetX += this.options.decVelX;
    this.options.targetY += this.options.decVelY;

    const diff = this.checkBounds();

    if (
      Math.abs(this.options.decVelX) <= stopThreshold &&
      Math.abs(this.options.decVelY) <= stopThreshold &&
      diff.inBounds
    ) {
      this.options.decelerating = false;
      return;
    }

    if (bounce) {
      const reboundAdjust = 2.5;

      if (diff.x !== 0) {
        if (diff.x * this.options.decVelX <= 0) {
          this.options.decVelX += diff.x * BOUNCE_DECELERATION;
        } else {
          const adjust = diff.x > 0 ? reboundAdjust : -reboundAdjust;
          this.options.decVelX = (diff.x + adjust) * BOUNCE_ACCELERATION;
        }
      }

      if (diff.y !== 0) {
        if (diff.y * this.options.decVelY <= 0) {
          this.options.decVelY += diff.y * BOUNCE_DECELERATION;
        } else {
          const adjust = diff.y > 0 ? reboundAdjust : -reboundAdjust;
          this.options.decVelY = (diff.y + adjust) * BOUNCE_ACCELERATION;
        }
      }
    } else {
      if (diff.x !== 0) {
        if (diff.x > 0) {
          this.options.targetX = this.options.boundXmin;
        } else {
          this.options.targetX = this.options.boundXmax;
        }

        this.options.decVelX = 0;
      }

      if (diff.y !== 0) {
        if (diff.y > 0) {
          this.options.targetY = this.options.boundYmin;
        } else {
          this.options.targetY = this.options.boundYmax;
        }

        this.options.decVelY = 0;
      }
    }

    this.callUpdateCallback();
    this.stepDecelRaf = requestAnimationFrame(this.stepDecelAnim);
  }

  /**
   * Records movement for the last 100ms
   * @param {number} x
   * @param {number} y [description]
   */
  addTrackingPoint = (x, y) => {
    const time = Date.now();

    while (this.options.trackingPoints.length > 0) {
      if (time - this.options.trackingPoints[0].time <= 100) {
        break;
      }

      this.options.trackingPoints.shift();
    }

    this.options.trackingPoints.push({ x, y, time });
  }

  /**
   * prevents animating faster than current framerate
   */
  requestTick = () => {
    if (!this.options.ticking) {
      this.tickRaf = requestAnimationFrame(this.updateAndRender);
    }

    this.options.ticking = true;
  }

  /**
   * Determine position relative to bounds
   * @param {Boolean} restrict Whether to restrict target to bounds
   */
  checkBounds = (restrict) => {
    const {
      boundXmin,
      boundXmax,
      boundYmin,
      boundYmax,
      targetX,
      targetY,
    } = this.options;

    let xDiff = 0;
    let yDiff = 0;

    if (boundXmin != null && targetX < boundXmin) {
      xDiff = boundXmin - targetX;
    } else if (boundXmax != null && targetX > boundXmax) {
      xDiff = boundXmax - targetX;
    }

    if (boundYmin != null && targetY < boundYmin) {
      yDiff = boundYmin - targetY;
    } else if (boundYmax != null && targetY > boundYmax) {
      yDiff = boundYmax - targetY;
    }

    if (restrict) {
      if (xDiff !== 0) {
        this.options.targetX = xDiff > 0 ? boundXmin : boundXmax;
      }

      if (yDiff !== 0) {
        this.options.targetY = yDiff > 0 ? boundYmin : boundYmax;
      }
    }

    return {
      x: xDiff,
      y: yDiff,
      inBounds: xDiff === 0 && yDiff === 0,
    };
  }

  /**
   * Calculate new values, call update function
   */
  updateAndRender = () => {
    this.tickRaf = null;

    const {
      bounce,
      multiplier,
      pointerCurrentX,
      pointerCurrentY,
      pointerLastX,
      pointerLastY,
    } = this.options;

    const pointerChangeX = pointerCurrentX - pointerLastX;
    const pointerChangeY = pointerCurrentY - pointerLastY;

    this.options.targetX += pointerChangeX * multiplier;
    this.options.targetY += pointerChangeY * multiplier;

    if (bounce) {
      const diff = this.checkBounds();

      if (diff.x !== 0) {
        this.options.targetX -= (
          pointerChangeX *
          dragOutOfBoundsMultiplier(diff.x) *
          multiplier
        );
      }

      if (diff.y !== 0) {
        this.options.targetY -= (
          pointerChangeY *
          dragOutOfBoundsMultiplier(diff.y) *
          multiplier
        );
      }
    } else {
      this.checkBounds(true);
    }

    this.callUpdateCallback();

    this.options.pointerLastX = pointerCurrentX;
    this.options.pointerLastY = pointerCurrentY;
    this.options.ticking = false;
  }

  onWheel = (event) => {
    this.options.targetX -= event.deltaX / 3;
    this.options.targetY -= event.deltaY / 3;
    this.options.decelerating = true;
    this.callUpdateCallback();
    this.options.decelerating = false;
  }

  /**
   * Handles move events
   * @param  {Object} ev Normalized event
   */
  onMove = (ev) => {
    ev.preventDefault();

    const event = normalizeEvent(ev);

    if (
      this.options.pointerActive &&
      event.id === this.options.pointerId
    ) {
      if (ev.deltaX != null) {
        this.options.pointerCurrentX = event.x + event.deltaX;
        this.options.pointerCurrentY = event.y + event.deltaY;
      } else {
        this.options.pointerCurrentX = event.x;
        this.options.pointerCurrentY = event.y;
      }

      this.addTrackingPoint(
        this.options.pointerLastX,
        this.options.pointerLastY,
      );

      this.requestTick();
    }
  }

  /**
   * Initializes movement tracking
   * @param  {Object} ev Normalized event
   */
  onDown = (ev) => {
    const event = normalizeEvent(ev);

    if (!this.options.pointerActive && !this.options.paused) {
      if (this.options.onDown) {
        this.options.onDown();
      }

      this.options.pointerActive = true;
      this.options.decelerating = false;
      this.options.pointerId = event.id;

      this.options.pointerCurrentX = event.x;
      this.options.pointerCurrentY = event.y;
      this.options.pointerLastX = event.x;
      this.options.pointerLastY = event.y;

      this.options.trackingPoints = [];
      this.addTrackingPoint(
        this.options.pointerLastX,
        this.options.pointerLastY,
      );

      // @see https://developers.google.com/web/updates/2017/01/scrolling-intervention
      document.addEventListener('mousemove', this.onMove, this.eventOptions);
      document.addEventListener('touchmove', this.onMove, this.eventOptions);
      document.addEventListener('touchcancel', this.stopTracking);
      document.addEventListener('touchend', this.onUp);
      document.addEventListener('mouseup', this.onUp);
    }
  }

  /**
   * Stops movement tracking, starts animation
   */
  stopTracking = () => {
    this.options.pointerActive = false;

    this.addTrackingPoint(
      this.options.pointerLastX,
      this.options.pointerLastY,
    );

    this.startDecelAnim();

    this.removeEventListeners();
  }

  removeEventListeners = () => {
    document.removeEventListener('mousemove', this.onMove, this.eventOptions);
    document.removeEventListener('touchmove', this.onMove, this.eventOptions);
    document.removeEventListener('touchend', this.onUp);
    document.removeEventListener('touchcancel', this.stopTracking);
    document.removeEventListener('mouseup', this.onUp);
  };

  /**
   * Handles up/end events
   * @param {Object} ev Normalized event
   */
  onUp = (ev) => {
    const event = normalizeEvent(ev);

    if (
      this.options.pointerActive &&
      event.id === this.options.pointerId
    ) {
      if (this.options.onUp) {
        this.options.onUp();
      }

      this.stopTracking();
    }
  }

  destroy = () => {
    window.removeEventListener('wheel', this.onWheel, this.eventOptions);
    this.sourceEl.removeEventListener('touchstart', this.onDown);
    this.sourceEl.removeEventListener('mousedown', this.onDown);
    this.sourceEl = null;
    return null;
  }

  /**
   * Disable movement processing
   * @public
   */
  pause = () => {
    this.options.pointerActive = false;
    this.options.paused = true;
  }

  /**
   * Enable movement processing
   * @public
   */
  resume = () => {
    this.options.paused = false;
  }

  /**
   * Update the current x and y values
   * @public
   * @param {Number} x
   * @param {Number} y
   */
  setValue = (x, y) => {
    if (typeof x === 'number') {
      this.options.targetX = x;
    }

    if (typeof y === 'number') {
      this.options.targetY = y;
    }
  };

  /**
   * Update the multiplier value
   * @public
   * @param {Number} val
   */
  setMultiplier = (val) => {
    this.options.multiplier = val;
    this.options.stopThreshold = STOP_THRESHOLD_DEFAULT * this.options.multiplier;
  }

  /**
   * Update boundX value
   * @public
   * @param {Number[]} boundX
   */
  setBoundX = ([boundXmin, boundXmax]) => {
    this.options.boundXmin = boundXmin;
    this.options.boundXmax = boundXmax;
  }

  /**
   * Update boundY value
   * @public
   * @param {Number[]} boundY
   */
  setBoundY = ([boundYmin, boundYmax]) => {
    this.options.boundYmin = boundYmin;
    this.options.boundYmax = boundYmax;
  }

  cancel = () => {
    this.options.decelerating = false;
    this.options.pointerActive = false;
    this.options.ticking = false;
    this.options.decVelX = 0;
    this.options.decVelY = 0;

    this.removeEventListeners();

    if (this.stepDecelRaf) {
      cancelAnimationFrame(this.stepDecelRaf);
      this.stepDecelRaf = null;
    }

    if (this.tickRaf) {
      cancelAnimationFrame(this.tickRaf);
      this.tickRaf = null;
    }
  }
}
