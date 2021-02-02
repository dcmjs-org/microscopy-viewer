import DragPan from "ol/interaction/DragPan";
import Overlay from "ol/Overlay";
import VectorLayer from "ol/layer/Vector";
import "ol/ol.css";
import VectorSource from "ol/source/Vector";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Collection from "ol/Collection";
import Feature from "ol/Feature";

import Enums from "../../enums";
import {
  getUnitsSuffix,
  getShortestLineBetweenOverlayAndFeature,
} from "./utils";
import defaultStyles from "../styles";

class _MarkupManager {
  constructor({
    map,
    source,
    formatters,
    onClick,
    onDrawStart,
    onDrawEnd,
    onStyle,
  } = {}) {
    this._map = map;
    this._source = source;
    this._formatters = formatters;

    this.onDrawStart = onDrawStart;
    this.onDrawEnd = onDrawEnd;
    this.onClick = onClick;
    this.onStyle = onStyle;

    this._markups = new Map();
    this._listeners = new Map();
    this._links = new Collection([], { unique: true });

    const defaultColor = defaultStyles.stroke.color;
    this._styleTag = document.createElement("style");
    this._styleTag.innerHTML = `
      .ol-tooltip {
        color: ${defaultColor};
        white-space: nowrap;
        font-size: 14px;
      }
      .ol-tooltip-measure { opacity: 1; }
      .ol-tooltip-static { color: ${defaultColor}; }
      .ol-tooltip-measure:before,
      .ol-tooltip-static:before {
        content: '',
      }

      #markup { cursor: move; }
      .markup-container { display: block !important; }
    `;

    this._linkStroke = new Stroke({
      color: defaultColor,
      lineDash: [0.3, 7],
      width: 3,
    });
    this._linksVector = new VectorLayer({
      source: new VectorSource({ features: this._links }),
      style: new Style({
        stroke: this._linkStroke,
      }),
    });

    this._markupsOverlay = new Overlay({ element: this._styleTag });
    this._map.addOverlay(this._markupsOverlay);
    this._map.addLayer(this._linksVector);

    this._onDrawStart = this._onDrawStart.bind(this);
    this._onDrawEnd = this._onDrawEnd.bind(this);
    this._onTranslateStart = this._onTranslateStart.bind(this);
    this._onModifyStart = this._onModifyStart.bind(this);

    this.bindInteractionEvents(this._map.getInteractions());
  }

  /**
   * Checks whether a markup exists.
   *
   * @param {string} id The markup id
   * @return {boolean}
   */
  has(id) {
    return this._markups.has(id);
  }

  /**
   * Returns a markup
   *
   * @param {string} id The markup id
   * @return {object} The markup
   */
  get(id) {
    return this._markups.get(id);
  }

  /**
   * Removes a markup and its link
   *
   * @param {string} id The markup id
   * @return {string} The markup id
   */
  remove(id) {
    const markup = this.get(id);
    if (!markup) return id;
    const links = this._links.getArray();
    const link = links.find((feature) => feature.getId() === id);
    if (link) this._links.remove(link);
    this._map.removeOverlay(markup.overlay);
    this._markups.delete(id);
    if (this._listeners.get(id)) this._listeners.delete(id);
    return id;
  }

  /**
   * Creates a new markup
   *
   * @param {object} options The options
   * @param {Feature} options.feature The feature to plug the measure markup
   * @param {string} options.value The inner content of element
   * @param {boolean} options.isLinkable Create a link between feature and markup
   * @param {boolean} options.isDraggable Allow markup to be dragged
   * @param {object} options.style Markup style
   * @param {array} offset Markup offset
   * @return {object} The markup object
   */
  create({
    feature,
    value = "",
    isLinkable = true,
    isDraggable = true,
    offset = [7, 7],
  }) {
    const id = feature.getId();
    if (!id) {
      console.warn("Failed to create markup, feature id not found");
      return;
    }

    if (this.has(id)) {
      console.warn("Markup for feature already exists", id);
      return this.get(id);
    }

    const styleTooltip = (feature) => {
      const styleOptions = feature.get("styleOptions");
      if (styleOptions && styleOptions.stroke) {
        const { color } = styleOptions.stroke;
        const tooltipColor = color || defaultStyles.stroke.color;
        this._linkStroke.setColor(tooltipColor);
        this._styleTag.innerHTML = `
        .ol-tooltip {
          color: ${tooltipColor};
          white-space: nowrap;
          font-size: 14px;
        }
        .ol-tooltip-measure { opacity: 1; }
        .ol-tooltip-static { color: ${tooltipColor}; }
        .ol-tooltip-measure:before,
        .ol-tooltip-static:before {
          content: '',
        }

        #markup { cursor: move; }
        .markup-container { display: block !important; }
      `;
      }
    };

    feature.on(
      Enums.FeatureEvents.PROPERTY_CHANGE,
      ({ key: property, target: feature }) => {
        if (property === "styleOptions") {
          styleTooltip(feature);
        }
      }
    );

    const markup = { id, isLinkable, isDraggable };

    const element = document.createElement("div");
    element.id = markup.isDraggable ? "markup" : "";
    element.className = "ol-tooltip ol-tooltip-measure";
    element.innerText = value;

    markup.element = element;
    markup.overlay = new Overlay({
      className: "markup-container",
      positioning: "center-center",
      stopEvent: false,
      dragging: false,
      offset,
      element: markup.element,
    });

    const featureCoordinate = feature.getGeometry().getLastCoordinate();
    markup.overlay.setPosition(featureCoordinate);

    let dragPan;
    let dragProperty = "dragging";
    this._map.getInteractions().forEach((interaction) => {
      if (interaction instanceof DragPan) {
        dragPan = interaction;
      }
    });

    element.addEventListener(Enums.HTMLElementEvents.MOUSE_DOWN, () => {
      const markup = this.get(id);
      if (markup) {
        dragPan.setActive(false);
        markup.overlay.set(dragProperty, true);
      }
    });

    this._map.on(Enums.MapEvents.POINTER_MOVE, (event) => {
      const markup = this.get(id);
      if (
        markup &&
        markup.overlay.get(dragProperty) === true &&
        markup.isDraggable
      ) {
        markup.overlay.setPosition(event.coordinate);
        this.drawLink(feature);
      }
    });

    this._map.on(Enums.MapEvents.POINTER_UP, () => {
      const markup = this.get(id);
      if (
        markup &&
        markup.overlay.get(dragProperty) === true &&
        markup.isDraggable
      ) {
        dragPan.setActive(true);
        markup.overlay.set(dragProperty, false);
      }
    });

    this._map.addOverlay(markup.overlay);
    this._markups.set(id, markup);

    this.drawLink(feature);

    return markup;
  }

  /**
   * Checks if feature has the correct markup
   *
   * @param {Feature} feature The feature
   */
  _isValidFeature(feature) {
    return Object.values(Enums.Markup).includes(feature.get("markup"));
  }

  /**
   * Update markup content
   *
   * @param {Feature} feature The feature
   * @param {string} value The markup content
   * @param {string} coordinate The markup coordinate
   */
  update({ feature, value, coordinate }) {
    const id = feature.getId();

    if (!id) {
      console.warn("Failed attempt to update markup, feature with empty id");
      return;
    }

    const markup = this.get(id);
    if (!markup) {
      console.warn("No markup found for given feature");
      return;
    }

    markup.element.innerText = value;
    if (coordinate) markup.overlay.setPosition(coordinate);
    this._markups.set(id, markup);
  }

  /**
   * Updates markup location on geometry change
   *
   * @param {object} event The event
   */
  _updateLocation(event) {
    event.features.forEach((feature) => {
      if (this._isValidFeature(feature)) {
        this._onFeatureGeometryChange({
          feature,
          coordinate: event.coordinate,
        });
      }
    });
  }

  /**
   * Get basic metadata of markup
   *
   * @param {Feature} feature The feature
   * @return {object} metadata
   */
  _getMetadata(feature) {
    const id = feature.getId();
    const markup = this.get(id);
    if (markup) {
      return {
        id: markup.id,
        value: markup.element.innerText,
        coordinate: markup.overlay.getPosition(),
      };
    }
  }

  /**
   * This event is responsible assign markup classes
   *
   * @param {object} event The event
   */
  _onDrawEnd(event) {
    this.onDrawEnd(event);
    const feature = event.feature;
    if (this._isValidFeature(feature)) {
      const featureId = feature.getId();
      const markup = this.get(featureId);
      if (markup) {
        markup.element.className = "ol-tooltip ol-tooltip-static";
        this._markups.set(featureId, markup);
      }
    }
  }

  /**
   * Returns the string format function for a given markup
   *
   * @param {object} feature The feature
   * @returns {function} format function
   */
  _getFormatter(feature) {
    const markup = feature.get("markup");
    const formatter = this._formatters[markup];
    if (!formatter) return () => "";
    return formatter;
  }

  /**
   * Update markup location on geometry change
   *
   * @param {object} feature The feature
   * @param {object} coordinate The markup coordinate
   */
  _onFeatureGeometryChange({ feature, coordinate }) {
    const featureId = feature.getId();
    const geometry = feature.getGeometry();

    const view = this._map.getView();
    const format = this._getFormatter(feature);
    const unitsSuffix = getUnitsSuffix(view);

    const listener = geometry.on(Enums.FeatureGeometryEvents.CHANGE, () => {
      if (this.has(featureId)) {
        const output = format(feature, unitsSuffix);
        this.update({
          feature,
          value: output,
          coordinate: geometry.getLastCoordinate(),
        });
        this.drawLink(feature);
      }
    });

    this._listeners.set(featureId, listener);
  }

  /**
   * Wire interaction events everytime new interactions is added or updated
   *
   * @param {object[]} interactions The map interactions
   */
  bindInteractionEvents(interactions) {
    if (interactions.draw) {
      this._listeners.set(
        Enums.InteractionEvents.DRAW_START,
        interactions.draw.on(
          Enums.InteractionEvents.DRAW_START,
          this._onDrawStart
        )
      );
      this._listeners.set(
        Enums.InteractionEvents.DRAW_END,
        interactions.draw.on(Enums.InteractionEvents.DRAW_END, this._onDrawEnd)
      );
    }

    if (interactions.translate) {
      this._listeners.set(
        Enums.InteractionEvents.TRANSLATE_START,
        interactions.translate.on(
          Enums.InteractionEvents.TRANSLATE_START,
          this._onTranslateStart
        )
      );
    }

    if (interactions.modify) {
      this._listeners.set(
        Enums.InteractionEvents.MODIFY_START,
        interactions.modify.on(
          Enums.InteractionEvents.MODIFY_START,
          this._onModifyStart
        )
      );
    }
  }

  /**
   * Wire interaction events everytime new interactions is added or updated
   *
   * @param {object[]} interactions The map interactions
   */
  onInteractionsChange(interactions) {
    this.bindInteractionEvents(interactions);
  }

  /**
   * Draws a link between the feature and the markup
   *
   * @param {object} feature The feature
   * @param {object} markup The markup
   */
  drawLink(feature) {
    const markup = this.get(feature.getId());
    if (!markup.isLinkable) {
      return;
    }

    const line = getShortestLineBetweenOverlayAndFeature(
      feature,
      markup.overlay
    );

    const updated = this._links.getArray().some((feature) => {
      if (feature.getId() === markup.id) {
        feature.setGeometry(line);
        return true;
      }
    });

    if (!updated) {
      const feature = new Feature({ geometry: line, name: "Line" });
      feature.setId(markup.id);
      this._links.push(feature);
    }
  }

  /**
   * Update the markup on drawstart
   * and caches it
   *
   * @param {object} event The drawstart event
   */
  _onDrawStart(event) {
    this.onDrawStart(event);
    const feature = event.feature;
    if (this._isValidFeature(feature)) {
      this._onFeatureGeometryChange({
        feature,
        coordinate: event.coordinate,
      });
    }
  }

  /**
   * Update markup location on translatestart
   *
   * @param {object} event The translatestart event
   */
  _onTranslateStart(event) {
    this._updateLocation(event);
  }

  /**
   * Update markup location on modifystart
   *
   * @param {object} event The modifystart event
   */
  _onModifyStart(event) {
    this._updateLocation(event);
  }
}

export default _MarkupManager;