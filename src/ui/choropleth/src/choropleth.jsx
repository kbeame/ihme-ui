import React, { PropTypes } from 'react';
import classNames from 'classnames';
import {
  geoClipExtent,
  geoPath,
  geoTransform,
  select,
  zoom,
  zoomIdentity,
  zoomTransform,
} from 'd3';
import { presimplify } from 'topojson';
import { bindAll, filter, has, isEqual, keyBy, memoize } from 'lodash';
import {
  calcCenterPoint,
  calcScale,
  calcTranslate,
  CommonPropTypes,
  concatAndComputeGeoJSONBounds,
  extractGeoJSON,
  propResolver,
  quickMerge,
} from '../../../utils';

import style from './choropleth.css';
import FeatureLayer from './feature-layer';
import Path from './path';
import Controls from './controls';

// slightly pad clip extent so that the boundary of the map does not show borders
const CLIP_EXTENT_PADDING = 1;

export default class Choropleth extends React.Component {
  /**
   * Because <Layer /> expects data to be an object with locationIds as keys
   * Need to process data as such
   * @param {Array} data - array of datum objects
   * @param {String|Function} keyField - string or function that resolves to unique property on datum objects
   * @return {Object} - keys are keyField (e.g., locationId), values are datum objects
   */
  static processData(data, keyField) {
    return keyBy(data, (datum) => propResolver(datum, keyField));
  }

  constructor(props) {
    super(props);

    const extractedGeoJSON = extractGeoJSON(presimplify(props.topology), props.layers);
    const bounds = concatAndComputeGeoJSONBounds(extractedGeoJSON);

    const scale = calcScale(props.width, props.height, bounds);

    const translate = calcTranslate(props.width, props.height, scale, bounds);
    this.clipExtent = geoClipExtent()
      .extent([
        [-CLIP_EXTENT_PADDING, -CLIP_EXTENT_PADDING],
        [props.width + CLIP_EXTENT_PADDING, props.height + CLIP_EXTENT_PADDING]
      ]);
    this.zoom = zoom()
      .scaleExtent([Math.max(scale, props.minZoom), Math.max(scale, props.maxZoom)]);

    this.calcMeshLayerStyle = memoize(this.calcMeshLayerStyle);

    this.state = {
      bounds,
      scale,
      scaleBase: scale,
      translate,
      pathGenerator: this.createPathGenerator(scale, translate, this.clipExtent),
      cache: { ...extractedGeoJSON, },
      processedData: Choropleth.processData(props.data, props.keyField)
    };

    bindAll(this, [
      'currentZoomTransform',
      'saveSvgRef',
      'zoomEvent',
      'zoomIn',
      'zoomOut',
      'zoomReset',
    ]);
  }

  componentDidMount() {
    const [x, y] = this.state.translate;

    this._svgSelection.call(
      this.zoom
        .on('zoom.ihme-ui-choropleth', this.zoomEvent)
    );

    this._svgSelection.call(
      this.zoom.transform,
      zoomIdentity
        .translate(x, y)
        .scale(this.state.scale)
    );
  }

  componentWillReceiveProps(nextProps) {
    // build up new state
    const state = {};

    // if topology or layers change, calc new bounds, and if bounds change, calc new scale
    if (nextProps.topology !== this.props.topology || nextProps.layers !== this.props.layers) {
      let topology;
      let cache;
      if (nextProps.topology === this.props.topology) {
        topology = nextProps.topology;
        cache = { ...this.state.cache };
      } else {
        topology = presimplify(nextProps.topology);
        cache = {};
      }

      const visibleLayers = filter(nextProps.layers, { visible: true });

      const uncachedLayers = filter(visibleLayers, (layer) =>
        layer.type === 'mesh' || !has(cache[layer.type], layer.name)
      );

      if (uncachedLayers.length) {
        state.cache = {
          ...quickMerge({}, cache, extractGeoJSON(topology, uncachedLayers))
        };

        const bounds = concatAndComputeGeoJSONBounds(state.cache);
        if (!isEqual(bounds, this.state.bounds)) {
          state.bounds = bounds;
        }
      }
    }

    // if the component has been resized or has new bounds, set a new base scale and translate
    if ((nextProps.width !== this.props.width) ||
        (nextProps.height !== this.props.height) ||
        state.bounds) {
      this.clipExtent = this.clipExtent
        .extent([
          [-CLIP_EXTENT_PADDING, -CLIP_EXTENT_PADDING],
          [nextProps.width + CLIP_EXTENT_PADDING, nextProps.height + CLIP_EXTENT_PADDING]
        ]);
      const bounds = state.bounds || this.state.bounds;

      state.scaleBase = calcScale(nextProps.width, nextProps.height, bounds);
      // new scale equals scale at which bounds fit perfectly within new width and height
      // transformed by how zoomed the current scale is (how much scaleFactor has been applied)
      state.scale = state.scaleBase * (this.state.scale / this.state.scaleBase);

      if (state.bounds) {
        // if state.bounds is set when topology or layers change drastically, reset calculations
        state.translate = calcTranslate(nextProps.width, nextProps.height,
                                        state.scaleBase, bounds);
      } else {
        // get current zoom transform (scale and translate)
        const transform = this.currentZoomTransform();

        // else calculate new translate from previous center point
        const center = calcCenterPoint(this.props.width, this.props.height,
                                        transform.k, [transform.x, transform.y]);
        state.translate = calcTranslate(nextProps.width, nextProps.height,
                                        state.scale, bounds, center);
      }

      state.pathGenerator = this.createPathGenerator(
        state.scale,
        state.translate,
        this.clipExtent
      );

      this._svgSelection.call(
        this.zoom.transform,
        zoomIdentity
          .translate(state.translate[0], state.translate[1])
          .scale(state.scale)
      );
    }

    // if the data has changed, transform it to be consumable by <Layer />
    if (nextProps.data !== this.props.data) {
      state.processedData = Choropleth.processData(nextProps.data, nextProps.keyField);
    }

    // if new state has any own and enumerable properties, update internal state
    if (Object.keys(state).length) {
      this.setState(state);
    }
  }

  /**
   * Avoid creating and recreating new style object
   * for mesh layers
   * @param key {*} Unique key for mesh layer used to memoize results of fun
   * @param style {Object|Function} Style object/function
   * @param feature {Object} the feature to be rendered by mesh layer
   *  if style is a function, it receives feature as its arg
   * @returns {Object}
   */
  calcMeshLayerStyle(key, layerStyle, feature) {
    const baseStyle = { pointerEvents: 'none' };
    const computedStyle = typeof layerStyle === 'function'
      ? layerStyle(feature)
      : layerStyle;
    return {
      ...baseStyle,
      ...computedStyle,
    };
  }

  /**
   * @param {array} scale
   * @param {array} translate
   * @param {object} clipExtent - d3.geo.clipExtent
   * @returns {function}
   */
  createPathGenerator(scale, translate, clipExtent) {
    const transform = geoTransform({
      point(x, y, z) {
        // mike bostock math
        const area = 1 / scale / scale;
        const pointX = x * scale + translate[0];
        const pointY = y * scale + translate[1];

        if (z >= area) {
          this.stream.point(pointX, pointY);
        }
      }
    });

    return geoPath().projection({
      stream: (pointStream) => transform.stream(clipExtent.stream(pointStream))
    });
  }

  zoomEvent() {
    const transform = this.currentZoomTransform();
    const scale = transform.k;
    const translate = [transform.x, transform.y];
    const pathGenerator = this.createPathGenerator(scale, translate, this.clipExtent);

    this.setState({
      scale,
      translate,
      pathGenerator,
    });
  }

  zoomIn() {
    this._svgSelection.call(this.zoom.scaleBy, this.props.zoomStep);
  }

  zoomOut() {
    this._svgSelection.call(this.zoom.scaleBy, 1 / this.props.zoomStep);
  }

  zoomReset() {
    const [x, y] = calcTranslate(this.props.width, this.props.height,
                                this.state.scaleBase, this.state.bounds);

    this._svgSelection.call(
      this.zoom.transform,
      zoomIdentity
        .translate(x, y)
        .scale(this.state.scaleBase)
    );
  }

  /**
   * return current zoom transform or identity transform if
   * svgNode does not exist or does not have a zoom transform
   */
  currentZoomTransform() {
    if (!this._svgNode) return zoomIdentity;
    return zoomTransform(this._svgNode);
  }

  saveSvgRef(ref) {
    this._svgNode = ref;
    this._svgSelection = ref && select(ref);
  }

  renderLayers() {
    return this.props.layers.map((layer) => {
      if (!layer.visible) return null;

      const key = `${layer.type}-${layer.name}`;

      switch (layer.type) {
        case 'feature':
          return (
            <FeatureLayer
              colorScale={this.props.colorScale}
              data={this.state.processedData}
              features={this.state.cache.feature[layer.name].features}
              geometryKeyField={this.props.geometryKeyField}
              key={key}
              keyField={this.props.keyField}
              onClick={this.props.onClick}
              onMouseLeave={this.props.onMouseLeave}
              onMouseMove={this.props.onMouseMove}
              onMouseOver={this.props.onMouseOver}
              pathClassName={layer.className}
              pathGenerator={this.state.pathGenerator}
              pathSelectedClassName={layer.selectedClassName}
              pathStyle={layer.style}
              pathSelectedStyle={layer.selectedStyle}
              selectedLocations={this.props.selectedLocations}
              valueField={this.props.valueField}
            />
          );
        case 'mesh':
          return (
            <Path
              className={layer.className}
              key={key}
              feature={this.state.cache.mesh[layer.name]}
              fill="none"
              pathGenerator={this.state.pathGenerator}
              style={this.calcMeshLayerStyle(key, layer.style, this.state.cache.mesh[layer.name])}
            />
          );
        default:
          return null;
      }
    });
  }

  render() {
    const { width, height } = this.props;

    return (
      <div
        className={classNames(style.common, this.props.className)}
        style={{ ...this.props.style, width: `${width}px`, height: `${height}px` }}
      >
        {this.props.controls && <Controls
          className={this.props.controlsClassName}
          style={this.props.controlsStyle}
          buttonClassName={this.props.controlsButtonClassName}
          buttonStyle={this.props.controlsButtonStyle}
          onZoomIn={this.zoomIn}
          onZoomOut={this.zoomOut}
          onZoomReset={this.zoomReset}
        />}
        <svg
          ref={this.saveSvgRef}
          width={`${width}px`}
          height={`${height}px`}
          overflow="hidden"
          style={{ pointerEvents: 'all' }}
        >
          {this.renderLayers()}
        </svg>
      </div>
    );
  }
}

Choropleth.propTypes = {
  /* classname to add rendered components */
  className: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.string,
  ]),

  /* fn that accepts keyfield, and returns stroke color for line */
  colorScale: PropTypes.func.isRequired,

  /* show zoom controls */
  controls: PropTypes.bool,

  /* classname to add to zoom controls container */
  controlsClassName: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.string,
  ]),

  /* classname to add to zoom control buttons */
  controlsButtonClassName: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.string,
  ]),

  /* inline styles to apply to zoom control buttons */
  controlsButtonStyle: PropTypes.object,

  /* inline styles to apply to zoom controls container */
  controlsStyle: PropTypes.object,

  /* array of datum objects */
  data: PropTypes.arrayOf(PropTypes.object).isRequired,

  /*
   uniquely identifying field of geometry objects
   if a function, will be called with the geometry object as first parameter
   N.B.: the resolved value of this prop should match the resolved value of `keyField` above
   e.g., if data objects are of the following shape: { location_id: <number>, mean: <number> }
   and if features within topojson are of the following shape: { type: <string>, properties: { location_id: <number> }, arcs: <array> }
   `keyField` may be one of the following: 'location_id', or (datum) => datum.location_id
   `geometryKeyField` may be one of the following: 'location_id' or (feature) => feature.properties.location_id
   */
  geometryKeyField: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.func,
  ]).isRequired,

  /* height of containing element, in px */
  height: PropTypes.number,

  /*
   unique key of datum
   if a function, will be called with the datum object as first parameter
   */
  keyField: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.func,
  ]).isRequired,

  /* layers to display */
  layers: PropTypes.arrayOf(PropTypes.shape({
    className: CommonPropTypes.className,

    // optional function to filter mesh grid, passed adjacent geometries
    // refer to https://github.com/mbostock/topojson/wiki/API-Reference#mesh
    filterFn: PropTypes.func,

    // along with layer.type, will be part of the `key` of the layer
    // therefore, `${layer.type}-${layer.name}` needs to be unique
    name: PropTypes.string.isRequired,

    // name corresponding to key within topojson objects collection
    object: PropTypes.string.isRequired,

    // applied to selected paths
    selectedClassName: CommonPropTypes.className,

    // applied to selected paths
    selectedStyle: PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.func,
    ]),

    // applied to paths
    style: PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.func,
    ]),

    // whether the layer should be a feature collection or mesh grid
    type: PropTypes.oneOf(['feature', 'mesh']).isRequired,

    // whether or not to render layer
    visible: PropTypes.bool,
  })).isRequired,

  /* max allowable zoom factor; 1 === fit bounds */
  maxZoom: PropTypes.number,

  /* min allowable zoom factor; 1 === fit bounds */
  minZoom: PropTypes.number,

  /* passed to each path; signature: function(event, datum, Path) {...} */
  onClick: PropTypes.func,

  /* passed to each path; signature: function(event, datum, Path) {...} */
  onMouseLeave: PropTypes.func,

  /* passed to each path; signature: function(event, datum, Path) {...} */
  onMouseMove: PropTypes.func,

  /* passed to each path; signature: function(event, datum, Path) {...} */
  onMouseOver: PropTypes.func,

  /* array of data */
  selectedLocations: PropTypes.arrayOf(PropTypes.object),

  /* inline styles to apply to choropleth container */
  style: PropTypes.object,

  /* full topojson */
  topology: PropTypes.shape({
    arcs: PropTypes.array,
    objects: PropTypes.object,
    transform: PropTypes.object,
    type: PropTypes.string
  }).isRequired,

  /* key of datum that holds the value to display */
  valueField: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.func,
  ]).isRequired,

  /* width of containing element, in px */
  width: PropTypes.number,

  /* amount to zoom in/out from zoom controls. current zoom scale is multiplied by prop value.
   e.g. 1.1 is equal to 10% steps, 2.0 is equal to 100% steps */
  zoomStep: PropTypes.number,
};

Choropleth.defaultProps = {
  controls: false,
  height: 400,
  layers: [],
  maxZoom: Infinity,
  minZoom: 0,
  selectedLocations: [],
  width: 600,
  zoomStep: 1.1,
};
