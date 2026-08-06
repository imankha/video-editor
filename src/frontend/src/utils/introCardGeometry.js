// GENERATED FROM app/services/intro_card_geometry.py — do not hand-edit.
// Regenerate: cd src/backend && .venv/Scripts/python.exe -m app.services.intro_card_geometry
// Parity is enforced by src/backend/tests/test_t5210_geometry_parity.py.
//
// Shared intro-card slot geometry + motion timing + treatment palette (T5210,
// measured layout + template typography T6640). See the Python module for the
// coordinate convention and the T6640 role/reflow/layout() rationale. The editor
// (T5205) reads THESE numbers so its live preview + motion + treatment swatches
// match the render engine.

export const CARD_ASPECTS = /* @parity:aspects:start */ {
  "landscape": "16:9",
  "portrait": "9:16"
} /* @parity:aspects:end */;

export const INTRO_CARD_GEOMETRY = /* @parity:geometry:start */ {
  "broadcast": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "left",
        "anchorFrac": 0.95,
        "anchorMode": "bottom",
        "anchorX": 0.06,
        "gapAfterTitle": 0.016,
        "gapGroup": 0.032,
        "gapLine": 0.01,
        "maxWidth": 0.58,
        "seamFeather": 0.0,
        "seamSide": "none"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.058
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.044
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.078,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.115
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "center",
        "anchorFrac": 0.9,
        "anchorMode": "bottom",
        "anchorX": 0.5,
        "gapAfterTitle": 0.012,
        "gapGroup": 0.026,
        "gapLine": 0.01,
        "maxWidth": 0.84,
        "seamFeather": 0.0,
        "seamSide": "none"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.036
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.028
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.048,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.068
        }
      }
    }
  },
  "hero": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "left",
        "anchorFrac": 0.93,
        "anchorMode": "bottom",
        "anchorX": 0.06,
        "gapAfterTitle": 0.018,
        "gapGroup": 0.035,
        "gapLine": 0.012,
        "maxWidth": 0.6,
        "seamFeather": 0.0,
        "seamSide": "none"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.062
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.052
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.085,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.125
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "center",
        "anchorFrac": 0.9,
        "anchorMode": "bottom",
        "anchorX": 0.5,
        "gapAfterTitle": 0.014,
        "gapGroup": 0.028,
        "gapLine": 0.01,
        "maxWidth": 0.84,
        "seamFeather": 0.0,
        "seamSide": "none"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.04
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.03
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.05,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.072
        }
      }
    }
  },
  "recruiting": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 0.52,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "left",
        "anchorFrac": 0.5,
        "anchorMode": "center",
        "anchorX": 0.575,
        "gapAfterTitle": 0.02,
        "gapGroup": 0.05,
        "gapLine": 0.012,
        "maxWidth": 0.4,
        "seamFeather": 0.18,
        "seamSide": "right"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.072
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.05
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.095,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.15
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 0.56,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "center",
        "anchorFrac": 0.94,
        "anchorMode": "bottom",
        "anchorX": 0.5,
        "gapAfterTitle": 0.012,
        "gapGroup": 0.03,
        "gapLine": 0.008,
        "maxWidth": 0.88,
        "seamFeather": 0.16,
        "seamSide": "bottom"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.044
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.03
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.052,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.076
        }
      }
    }
  },
  "title-only": {
    "16:9": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "center",
        "anchorFrac": 0.47,
        "anchorMode": "center",
        "anchorX": 0.5,
        "gapAfterTitle": 0.025,
        "gapGroup": 0.025,
        "gapLine": 0.012,
        "maxWidth": 0.86,
        "seamFeather": 0.0,
        "seamSide": "none"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.07
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.062
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.1,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.15
        }
      }
    },
    "9:16": {
      "photo": {
        "h": 1.0,
        "w": 1.0,
        "x": 0.0,
        "y": 0.0
      },
      "reflow": {
        "align": "center",
        "anchorFrac": 0.45,
        "anchorMode": "center",
        "anchorX": 0.5,
        "gapAfterTitle": 0.02,
        "gapGroup": 0.02,
        "gapLine": 0.01,
        "maxWidth": 0.86,
        "seamFeather": 0.0,
        "seamSide": "none"
      },
      "typography": {
        "primary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.04
        },
        "secondary": {
          "font": "oswald",
          "shadow": {
            "blur": 0.04,
            "color": "#000000",
            "opacity": 0.55
          },
          "size": 0.036
        },
        "title": {
          "font": "anton",
          "maxLines": 2,
          "minSize": 0.058,
          "shadow": {
            "blur": 0.05,
            "color": "#000000",
            "opacity": 0.6
          },
          "size": 0.08
        }
      }
    }
  }
} /* @parity:geometry:end */;

export const INTRO_CARD_TREATMENTS = /* @parity:treatments:start */ {
  "dark": {
    "accent": "#e5e7eb",
    "background": {
      "center": [
        0.5,
        0.0
      ],
      "css": "radial-gradient(120% 120% at 50% 0%, #1a2230 0%, #05070b 70%)",
      "extent": [
        1.2,
        1.2
      ],
      "stops": [
        {
          "color": "#1a2230",
          "pos": 0.0
        },
        {
          "color": "#05070b",
          "pos": 0.7
        }
      ],
      "type": "radial"
    },
    "band": {
      "color": "#0e1622",
      "featherFrac": 0.16,
      "heightFrac": 0.44,
      "opacity": 0.92
    },
    "photoMood": {
      "tint": {
        "color": "#16233a",
        "opacity": 0.26
      },
      "vignette": {
        "extent": 0.74,
        "innerFrac": 0.38,
        "opacity": 0.62
      }
    },
    "seamColor": "#05070b"
  },
  "gold": {
    "accent": "#f7e28b",
    "background": {
      "center": [
        0.5,
        0.0
      ],
      "css": "radial-gradient(120% 120% at 50% 0%, #2a2410 0%, #0d0b06 70%)",
      "extent": [
        1.2,
        1.2
      ],
      "stops": [
        {
          "color": "#2a2410",
          "pos": 0.0
        },
        {
          "color": "#0d0b06",
          "pos": 0.7
        }
      ],
      "type": "radial"
    },
    "band": {
      "color": "#241a0b",
      "featherFrac": 0.16,
      "heightFrac": 0.44,
      "opacity": 0.9
    },
    "photoMood": {
      "tint": {
        "color": "#5a3a12",
        "opacity": 0.22
      },
      "vignette": {
        "extent": 0.78,
        "innerFrac": 0.45,
        "opacity": 0.5
      }
    },
    "seamColor": "#0d0b06"
  },
  "photo-forward": {
    "accent": "#ffffff",
    "background": {
      "color": "#04060a",
      "css": "#04060a",
      "type": "solid"
    },
    "band": null,
    "photoMood": {
      "tint": null,
      "vignette": null
    },
    "seamColor": "#04060a"
  }
} /* @parity:treatments:end */;

export const INTRO_CARD_MOTION = /* @parity:motion:start */ {
  "flashOutD": 0.22,
  "photoPushInZoomEnd": 1.12,
  "photoPushInZoomStart": 1.0,
  "textFadeD": 0.45,
  "textRiseFrac": 0.02,
  "textStaggerFirstSt": 0.35,
  "textStaggerStep": 0.16
} /* @parity:motion:end */;

export const STAGGER_ORDER = /* @parity:staggerOrder:start */ ["title", "subtitle", "fact1", "fact2", "fact3"] /* @parity:staggerOrder:end */;

export const BAND_COMPOSITIONS = /* @parity:bandCompositions:start */ ["hero", "broadcast"] /* @parity:bandCompositions:end */;

// T6640: ordinal SLOT -> typography ROLE (title/primary/secondary). Mirrors
// `intro_card_geometry.ROLE_FOR_SLOT` exactly.
export const ROLE_FOR_SLOT = /* @parity:roleForSlot:start */ {
  "fact1": "primary",
  "fact2": "secondary",
  "fact3": "secondary",
  "subtitle": "secondary",
  "title": "title"
} /* @parity:roleForSlot:end */;

// T6640: the fixed colour every "secondary"-role element uses (subtitle,
// fact2, fact3) — one flat muted grey across all three treatments.
export const MUTED_COLOR = /* @parity:mutedColor:start */ "#c3cad6" /* @parity:mutedColor:end */;

/**
 * Resolve an output frame size to its contract aspect key. Mirrors
 * `intro_card_geometry.aspect_key` on the backend (landscape/square -> 16:9).
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function aspectKey(width, height) {
  return width >= height ? CARD_ASPECTS.landscape : CARD_ASPECTS.portrait;
}

/**
 * `{photo, reflow, typography}` for a composition + aspect key. Throws on an
 * unknown key (a drift bug, never a silent fallback) to match the Python
 * accessor.
 * @param {string} composition one of COMPOSITION.* (introCardComposition.js)
 * @param {string} aspect one of CARD_ASPECTS.*
 */
export function geometryFor(composition, aspect) {
  const byAspect = INTRO_CARD_GEOMETRY[composition];
  const geo = byAspect && byAspect[aspect];
  if (!geo) {
    throw new Error(
      `no intro card geometry for composition=${composition} aspect=${aspect}`
    );
  }
  return geo;
}

/**
 * `{background, accent, band, photoMood, seamColor}` for a treatment key.
 * Throws on an unknown key.
 * @param {string} treatment one of TREATMENTS (introCardComposition.js)
 */
export function treatmentFor(treatment) {
  const t = INTRO_CARD_TREATMENTS[treatment];
  if (!t) {
    throw new Error(`unknown treatment=${treatment}`);
  }
  return t;
}

/**
 * Whether a treatment band applies for a composition (`bottom` | `none`).
 * Mirrors `intro_card_geometry.band_kind` so preview and export gate it the same.
 * @param {string} composition one of COMPOSITION.* (introCardComposition.js)
 */
export function bandKind(composition) {
  return BAND_COMPOSITIONS.includes(composition) ? 'bottom' : 'none';
}
