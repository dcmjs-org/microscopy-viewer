import _MarkupManager from "./markups/_MarkupManager";

/** Enums */
import Enums from "../enums";

/** Markers */
import ArrowMarker, { format as arrowFormat } from "./markers/arrow";

/** Markups */
import MeasurementMarkup, {
  format as measurementFormat,
} from "./markups/measurement";
import TextEvaluationMarkup, { format as textFormat } from "./markups/text";

/** Utils */
import { getContentItemNameMeaning } from "../utils";

const { Marker, Markup } = Enums;

class _AnnotationManager {
  constructor({ map } = {}) {
    const markupManager = new _MarkupManager({
      map,
      formatters: {
        [Marker.Arrow]: arrowFormat,
        [Markup.Measurement]: measurementFormat,
        [Markup.TextEvaluation]: textFormat,
      },
    });

    this.props = {
      map,
      markupManager,
    };

    /** Markups */
    this[Markup.Measurement] = MeasurementMarkup(this.props);
    this[Markup.TextEvaluation] = TextEvaluationMarkup(this.props);

    /** Markers */
    this[Marker.Arrow] = ArrowMarker(this.props);
  }

  /**
   * Add markup properties based on ROI
   * measurements and evaluations
   *
   * @param {Feature} feature The feature
   */
  _addMeasurementsAndEvaluationsProperties(feature) {
    const { measurements, evaluations } = feature.getProperties();

    if (measurements && measurements.length) {
      return measurements.some((measurement) => {
        const SUPPORTED_MEASUREMENTS = ["Area", "Length"];
        const codeMeaning = getContentItemNameMeaning(measurement);
        if (SUPPORTED_MEASUREMENTS.includes(codeMeaning)) {
          feature.set(
            Enums.InternalProperties.Markup,
            Enums.Markup.Measurement
          );
        }
      });
    }

    if (evaluations && evaluations.length) {
      return evaluations.some((evaluation) => {
        const SUPPORTED_EVALUATIONS = ["Tracking Identifier"];
        const codeMeaning = getContentItemNameMeaning(evaluation);
        if (SUPPORTED_EVALUATIONS.includes(codeMeaning)) {
          feature.set(
            Enums.InternalProperties.Markup,
            Enums.Markup.TextEvaluation
          );
        }
      });
    }
  }

  onAdd(feature) {
    /**
     * Add properties to ROI feature before triggering
     * markup and markers callbacks to keep UI in sync
     */
    this._addMeasurementsAndEvaluationsProperties(feature);

    this[Marker.Arrow].onAdd(feature);
    this[Markup.Measurement].onAdd(feature);
    this[Markup.TextEvaluation].onAdd(feature);
  }

  onRemove(feature) {
    this[Marker.Arrow].onRemove(feature);
    this[Markup.Measurement].onRemove(feature);
    this[Markup.TextEvaluation].onRemove(feature);
  }

  onUpdate(feature) {
    this[Marker.Arrow].onUpdate(feature);
    this[Markup.Measurement].onUpdate(feature);
    this[Markup.TextEvaluation].onUpdate(feature);
  }

  onDrawStart(event) {
    this[Marker.Arrow].onDrawStart(event);
    this[Markup.Measurement].onDrawStart(event);
    this[Markup.TextEvaluation].onDrawStart(event);
  }

  onDrawEnd(event) {
    this[Marker.Arrow].onDrawEnd(event);
    this[Markup.Measurement].onDrawEnd(event);
    this[Markup.TextEvaluation].onDrawEnd(event);
    this.props.markupManager.onDrawEnd(event);
  }
}

export default _AnnotationManager;