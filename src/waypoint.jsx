import React, { PropTypes, Component, Children } from 'react';
import { addEventListener, removeEventListener } from 'consolidated-events';

const POSITIONS = {
  above: 'above',
  inside: 'inside',
  below: 'below',
  invisible: 'invisible',
};

const defaultProps = {
  topOffset: '0px',
  bottomOffset: '0px',
  horizontal: false,
  onEnter() {},
  onLeave() {},
  onPositionChange() {},
  fireOnRapidScroll: true,
};

function debugLog() {
  console.log(arguments); // eslint-disable-line no-console
}

/**
 * @param {object} bounds An object with bounds data for the waypoint and
 *   scrollable parent
 * @return {string} The current position of the waypoint in relation to the
 *   visible portion of the scrollable parent. One of `POSITIONS.above`,
 *   `POSITIONS.below`, or `POSITIONS.inside`.
 */
function getCurrentPosition(bounds) {
  const { waypointTop, waypointBottom, viewportTop, viewportBottom } = bounds;

  if (viewportBottom - viewportTop === 0) {
    return POSITIONS.invisible;
  }

  if ((viewportTop <= waypointTop && waypointTop <= viewportBottom) ||
      (viewportTop <= waypointBottom && waypointBottom <= viewportBottom)) {
    return POSITIONS.inside;
  }

  if (viewportBottom < waypointTop) {
    return POSITIONS.below;
  }

  if (waypointBottom < viewportTop) {
    return POSITIONS.above;
  }

  return POSITIONS.invisible;
}

/**
 * Attempts to parse the offset provided as a prop as a pixel value. If
 * parsing fails, then `undefined` is returned. Three examples of values that
 * will be successfully parsed are:
 * `20`
 * "20px"
 * "20"
 *
 * @param {string|number} str A string of the form "{number}" or "{number}px",
 *   or just a number.
 * @return {number|undefined} The numeric version of `str`. Undefined if `str`
 *   was neither a number nor string ending in "px".
 */
function parseOffsetAsPixels(str) {
  if (!isNaN(parseFloat(str)) && isFinite(str)) {
    return parseFloat(str);
  } else if (str.slice(-2) === 'px') {
    return parseFloat(str.slice(0, -2));
  }
}

/**
 * Attempts to parse the offset provided as a prop as a percentage. For
 * instance, if the component has been provided with the string "20%" as
 * a value of one of the offset props. If the value matches, then it returns
 * a numeric version of the prop. For instance, "20%" would become `0.2`.
 * If `str` isn't a percentage, then `undefined` will be returned.
 *
 * @param {string} str The value of an offset prop to be converted to a
 *   number.
 * @return {number|undefined} The numeric version of `str`. Undefined if `str`
 *   was not a percentage.
 */
function parseOffsetAsPercentage(str) {
  if (str.slice(-1) === '%') {
    return parseFloat(str.slice(0, -1)) / 100;
  }
}

/**
 * @param {string|number} offset
 * @param {number} contextHeight
 * @return {number} A number representing `offset` converted into pixels.
 */
function computeOffsetPixels(offset, contextHeight) {
  const pixelOffset = parseOffsetAsPixels(offset);

  if (typeof pixelOffset === 'number') {
    return pixelOffset;
  }

  const percentOffset = parseOffsetAsPercentage(offset);
  if (typeof percentOffset === 'number') {
    return percentOffset * contextHeight;
  }
}


/**
 * Calls a function when you scroll to the element.
 */
export default class Waypoint extends Component {
  constructor(props) {
    super(props);

    this.beforeRef = (el) => this._beforeRef = el;
    this.afterRef = (el) => this._afterRef = el;
    this.genericRef = (el) => {
      this.beforeRef(el);
      this.afterRef(el);
    };
  }

  componentWillMount() {
    if (this.props.scrollableParent) { // eslint-disable-line react/prop-types
      throw new Error('The `scrollableParent` prop has changed name to `scrollableAncestor`.');
    }
  }

  componentDidMount() {
    if (!Waypoint.getWindow()) {
      return;
    }

    this._handleScroll = this._handleScroll.bind(this);
    this.scrollableAncestor = this._findScrollableAncestor();

    if (this.props.debug) {
      debugLog('scrollableAncestor', this.scrollableAncestor);
    }

    this.scrollEventListenerHandle = addEventListener(
      this.scrollableAncestor,
      'scroll',
      this._handleScroll,
      { passive: true }
    );

    this.resizeEventListenerHandle = addEventListener(
      window,
      'resize',
      this._handleScroll,
      { passive: true }
    );

    // waypoint refs may occasionally not be set at this time. To help ensure that
    // this works smoothly, we want to delay the initial execution until the
    // next tick.
    setTimeout(() => {
      this._handleScroll(null);
    }, 0);
  }

  componentDidUpdate() {
    if (!Waypoint.getWindow()) {
      return;
    }

    // The element may have moved.
    this._handleScroll(null);
  }

  componentWillUnmount() {
    if (!Waypoint.getWindow()) {
      return;
    }

    removeEventListener(this.scrollEventListenerHandle);
    removeEventListener(this.resizeEventListenerHandle);
  }

  /**
   * Traverses up the DOM to find an ancestor container which has an overflow
   * style that allows for scrolling.
   *
   * @return {Object} the closest ancestor element with an overflow style that
   *   allows for scrolling. If none is found, the `window` object is returned
   *   as a fallback.
   */
  _findScrollableAncestor() {
    if (this.props.scrollableAncestor) {
      return this.props.scrollableAncestor;
    }

    // Scrollable ancestor should be the same regardless of which ref we use
    let node = this._beforeRef;

    while (node.parentNode) {
      node = node.parentNode;

      if (node === document) {
        // This particular node does not have a computed style.
        continue;
      }

      if (node === document.documentElement) {
        // This particular node does not have a scroll bar, it uses the window.
        continue;
      }

      const style = window.getComputedStyle(node);
      const overflowDirec = this.props.horizontal ?
        style.getPropertyValue('overflow-x') :
        style.getPropertyValue('overflow-y');
      const overflow = overflowDirec || style.getPropertyValue('overflow');

      if (overflow === 'auto' || overflow === 'scroll') {
        return node;
      }
    }

    // A scrollable ancestor element was not found, which means that we need to
    // do stuff on window.
    return window;
  }

  /**
   * @param {Object} event the native scroll event coming from the scrollable
   *   ancestor, or resize event coming from the window. Will be undefined if
   *   called by a React lifecyle method
   */
  _handleScroll(event) {
    if (!this._beforeRef || !this._afterRef) {
      // There's a chance we end up here after the component has been unmounted.
      return;
    }

    const bounds = this._getBounds();
    const currentPosition = getCurrentPosition(bounds);
    const previousPosition = this._previousPosition;

    if (this.props.debug) {
      debugLog('currentPosition', currentPosition);
      debugLog('previousPosition', previousPosition);
    }

    // Save previous position as early as possible to prevent cycles
    this._previousPosition = currentPosition;

    if (previousPosition === currentPosition) {
      // No change since last trigger
      return;
    }

    const callbackArg = {
      currentPosition,
      previousPosition,
      event,
      waypointTop: bounds.waypointTop,
      waypointBottom: bounds.waypointBottom,
      viewportTop: bounds.viewportTop,
      viewportBottom: bounds.viewportBottom,
    };
    this.props.onPositionChange.call(this, callbackArg);

    if (currentPosition === POSITIONS.inside) {
      this.props.onEnter.call(this, callbackArg);
    } else if (previousPosition === POSITIONS.inside) {
      this.props.onLeave.call(this, callbackArg);
    }

    const isRapidScrollDown = previousPosition === POSITIONS.below &&
      currentPosition === POSITIONS.above;
    const isRapidScrollUp = previousPosition === POSITIONS.above &&
      currentPosition === POSITIONS.below;

    if (this.props.fireOnRapidScroll && (isRapidScrollDown || isRapidScrollUp)) {
      // If the scroll event isn't fired often enough to occur while the
      // waypoint was visible, we trigger both callbacks anyway.
      this.props.onEnter.call(this, {
        currentPosition: POSITIONS.inside,
        previousPosition,
        event,
        waypointTop: bounds.waypointTop,
        waypointBottom: bounds.waypointBottom,
        viewportTop: bounds.viewportTop,
        viewportBottom: bounds.viewportBottom,
      });
      this.props.onLeave.call(this, {
        currentPosition,
        previousPosition: POSITIONS.inside,
        event,
        waypointTop: bounds.waypointTop,
        waypointBottom: bounds.waypointBottom,
        viewportTop: bounds.viewportTop,
        viewportBottom: bounds.viewportBottom,
      });
    }
  }

  _getBounds() {
    const horizontal = this.props.horizontal;
    const waypointTop = horizontal ? this._beforeRef.getBoundingClientRect().left :
      this._beforeRef.getBoundingClientRect().top;
    const waypointBottom = horizontal ? this._afterRef.getBoundingClientRect().right :
      this._afterRef.getBoundingClientRect().bottom;

    let contextHeight;
    let contextScrollTop;
    if (this.scrollableAncestor === window) {
      contextHeight = horizontal ? window.innerWidth : window.innerHeight;
      contextScrollTop = 0;
    } else {
      contextHeight = horizontal ? this.scrollableAncestor.offsetWidth :
        this.scrollableAncestor.offsetHeight;
      contextScrollTop = horizontal ?
        this.scrollableAncestor.getBoundingClientRect().left :
        this.scrollableAncestor.getBoundingClientRect().top;
    }

    if (this.props.debug) {
      debugLog('waypoint top', waypointTop);
      debugLog('waypoint bottom', waypointBottom);
      debugLog('scrollableAncestor height', contextHeight);
      debugLog('scrollableAncestor scrollTop', contextScrollTop);
    }

    const { bottomOffset, topOffset } = this.props;
    const topOffsetPx = computeOffsetPixels(topOffset, contextHeight);
    const bottomOffsetPx = computeOffsetPixels(bottomOffset, contextHeight);
    const contextBottom = contextScrollTop + contextHeight;

    return {
      waypointTop,
      waypointBottom,
      viewportTop: contextScrollTop + topOffsetPx,
      viewportBottom: contextBottom - bottomOffsetPx,
    };
  }

  /**
   * @return {Object}
   */
  render() {
    // If no children are supplied we need an element that we can locate in the
    // DOM to determine where it is rendered relative to the top of its context.
    let children = <span ref={this.genericRef} style={{ all: 'unset', fontSize: 0 }} />;

    // If children are supplied we can attatch refs to the respective top and bottoms
    if (Children.count(this.props.children) > 0) {
      children = Children.map(this.props.children, (child, index) => {
        // There must be a better way of adding ref other than cloning
        if (Children.count(this.props.children)) {
          return React.cloneElement(child, { ref: this.genericRef });
        }

        if (index === 0) {
          return React.cloneElement(child, { ref: this.beforeRef });
        }

        if (index === Children.count) {
          return React.cloneElement(child, { ref: this.afterRef });
        }

        return child;
      });
    }

    return children;
  }
}

Waypoint.propTypes = {
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.node),
    PropTypes.node,
  ]),
  debug: PropTypes.bool,
  onEnter: PropTypes.func,
  onLeave: PropTypes.func,
  onPositionChange: PropTypes.func,
  fireOnRapidScroll: PropTypes.bool,
  scrollableAncestor: PropTypes.any,
  horizontal: PropTypes.bool,

  // `topOffset` can either be a number, in which case its a distance from the
  // top of the container in pixels, or a string value. Valid string values are
  // of the form "20px", which is parsed as pixels, or "20%", which is parsed
  // as a percentage of the height of the containing element.
  // For instance, if you pass "-20%", and the containing element is 100px tall,
  // then the waypoint will be triggered when it has been scrolled 20px beyond
  // the top of the containing element.
  topOffset: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),

  // `bottomOffset` is like `topOffset`, but for the bottom of the container.
  bottomOffset: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
};

Waypoint.above = POSITIONS.above;
Waypoint.below = POSITIONS.below;
Waypoint.inside = POSITIONS.inside;
Waypoint.invisible = POSITIONS.invisible;
Waypoint.getWindow = () => {
  if (typeof window !== 'undefined') {
    return window;
  }
};
Waypoint.defaultProps = defaultProps;
Waypoint.displayName = 'Waypoint';
