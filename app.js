(() => {
  const pdfjsLib = window["pdfjs-dist/build/pdf"] || window.pdfjsLib;
  if (!pdfjsLib) {
    alert("PDF.js failed to load.");
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  const { PDFDocument } = window.PDFLib || {};

  const TEMPLATE_URL = "assets/TCC-Lanyards-Fillable-Template.pdf";
  const getFieldStyle = (fieldName = "") => {
    const name = String(fieldName).toLowerCase();
    if (name.includes("ministry")) {
      return { weight: "light", fontSize: 11, color: "#a8ccd5", letterSpacing: 4 };
    }
    if (name.includes("first")) {
      return { weight: "black", fontSize: 30, color: "#ffffff" };
    }
    if (name.includes("last")) {
      return { weight: "light", fontSize: 22, color: "#ffffff" };
    }
    return { weight: "light" };
  };

  const elements = {
    root: document.getElementById("pdf-root"),
    status: document.getElementById("status"),
    error: document.getElementById("error"),
    downloadFlattened: document.getElementById("download-flattened"),
    reset: document.getElementById("reset-fields"),
  };

  const state = {
    pdfBytes: null,
    pdfDoc: null,
    annotationStorage: null,
    fieldValues: Object.create(null),
    fieldMeta: Object.create(null),
    annotationIds: [],
    annotationsByPage: Object.create(null),
    mirrorMap: Object.create(null),
    ministryValues: Object.create(null),
    ministryPositions: [],
    scale: 1,
    renderToken: 0,
  };

  const debounce = (fn, delay) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  };

  const copyPdfBytes = () => {
    if (!state.pdfBytes) return null;
    return state.pdfBytes.slice();
  };

  const setStatus = (message) => {
    elements.status.textContent = message;
  };

  const showError = (message) => {
    elements.error.textContent = message;
    elements.error.hidden = false;
  };

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };

  const setBusy = (busy) => {
    elements.downloadFlattened.disabled = busy;
    elements.reset.disabled = busy;
  };

  const resetFields = () => {
    state.fieldValues = Object.create(null);
    if (state.annotationStorage) {
      state.annotationIds.forEach((id) => {
        const meta = state.fieldMeta[id];
        if (meta?.fieldType === "Btn") {
          state.annotationStorage.setValue(id, { value: "Off" });
        } else {
          state.annotationStorage.setValue(id, { value: "" });
        }
      });
      state.annotationStorage.resetModified();
    }
    state.ministryValues = Object.create(null);
    document.querySelectorAll(".annotation-layer input, .annotation-layer textarea").forEach((input) => {
      if (input.type === "checkbox") {
        input.checked = false;
      } else {
        input.value = "";
      }
    });
  };

  const toUint8Array = (dataUrl) => {
    const [header, base64] = dataUrl.split(",");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const downloadBytes = (bytes, filename) => {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const mirrorValue = (sourceName, value) => {
    const targetName = state.mirrorMap[sourceName];
    if (!targetName) return;
    state.fieldValues[targetName] = value;
    const targetInput = document.querySelector(
      `.annotation-layer [data-field-name="${cssEscape(targetName)}"]`
    );
    if (targetInput && targetInput.value !== value) {
      targetInput.value = value;
    }
  };

  const updateFieldValue = (annotation, value) => {
    if (!annotation?.fieldName) return;
    state.fieldValues[annotation.fieldName] = value;
    if (annotation.pageNumber === 1) {
      mirrorValue(annotation.fieldName, value);
    }

    if (!state.annotationStorage) return;
    if (annotation.fieldType === "Btn") {
      const onValue = annotation.exportValue || "Yes";
      state.annotationStorage.setValue(annotation.id, {
        value: value ? onValue : "Off",
      });
      return;
    }

    state.annotationStorage.setValue(annotation.id, { value });
  };

  const createWidget = (annotation, viewport, pageWrapper, pageNumber) => {
    if (!state.fieldMeta[annotation.id]) {
      state.annotationIds.push(annotation.id);
      state.fieldMeta[annotation.id] = {
        fieldType: annotation.fieldType,
        exportValue: annotation.exportValue,
      };
    }
    const rect = viewport.convertToViewportRectangle(annotation.rect);
    const left = Math.min(rect[0], rect[2]);
    const top = Math.min(rect[1], rect[3]);
    const width = Math.abs(rect[0] - rect[2]);
    const height = Math.abs(rect[1] - rect[3]);

    let input;
    const annotationLayer = pageWrapper.querySelector(".annotation-layer");
    if (annotation.fieldType === "Btn" && annotation.checkBox) {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = annotation.fieldValue === (annotation.exportValue || "Yes");
      updateFieldValue(annotation, input.checked);
    } else if (annotation.fieldType === "Tx") {
      if (annotation.multiLine) {
        input = document.createElement("textarea");
      } else {
        input = document.createElement("input");
        input.type = "text";
      }
      const startingValue = state.fieldValues[annotation.fieldName] ?? annotation.fieldValue ?? "";
      input.value = startingValue;
      updateFieldValue(annotation, startingValue);
      const style = getFieldStyle(annotation.fieldName);
      const fontSize = style.fontSize || annotation.textSize || Math.max(height * 0.6, 10);
      input.style.fontSize = `${fontSize}px`;
      input.style.fontWeight = style.weight === "black" ? "800" : "300";
      if (style.color) {
        input.style.color = style.color;
        input.classList.add("field-white-text");
      }
      if (annotation.textAlignment === 1) {
        input.style.textAlign = "center";
      } else if (annotation.textAlignment === 2) {
        input.style.textAlign = "right";
      }
    } else {
      return;
    }

    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${width}px`;
    input.style.height = `${height}px`;

    input.classList.add("field-highlight");
    input.dataset.fieldName = annotation.fieldName || "";
    input.dataset.pageNumber = String(pageNumber);

    input.addEventListener("input", () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      updateFieldValue(annotation, value);
    });

    const backdrop = document.createElement("div");
    backdrop.className = "field-backdrop";
    backdrop.style.left = `${left}px`;
    backdrop.style.top = `${top}px`;
    backdrop.style.width = `${width}px`;
    backdrop.style.height = `${height}px`;

    annotationLayer.appendChild(backdrop);
    annotationLayer.appendChild(input);
  };

  const createMinistryFields = (viewport, pageWrapper) => {
    const firstNameFields = (state.annotationsByPage[1] || []).filter((f) =>
      String(f.fieldName || "").toLowerCase().includes("first")
    );
    if (!firstNameFields.length) return;

    const annotationLayer = pageWrapper.querySelector(".annotation-layer");
    state.ministryPositions = [];

    firstNameFields.forEach((field, index) => {
      const fieldHeight = Math.abs(field.rect[3] - field.rect[1]);
      const fieldWidth = Math.abs(field.rect[2] - field.rect[0]);
      const ministryHeight = fieldHeight * 0.45;
      const yOffset = fieldHeight * 1.8;

      const pdfRect = [
        field.rect[0],
        field.rect[1] + yOffset,
        field.rect[2],
        field.rect[1] + yOffset + ministryHeight,
      ];

      state.ministryPositions.push({ index, pdfRect, fieldWidth });

      const rect = viewport.convertToViewportRectangle(pdfRect);
      const left = Math.min(rect[0], rect[2]);
      const top = Math.min(rect[1], rect[3]);
      const width = Math.abs(rect[0] - rect[2]);
      const height = Math.abs(rect[1] - rect[3]);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "field-highlight ministry-input";
      input.dataset.ministryIndex = String(index);
      input.placeholder = "MINISTRY";
      input.value = state.ministryValues[index] || "";
      input.style.left = `${left}px`;
      input.style.top = `${top}px`;
      input.style.width = `${width}px`;
      input.style.height = `${height}px`;

      input.addEventListener("input", () => {
        state.ministryValues[index] = input.value;
      });

      const backdrop = document.createElement("div");
      backdrop.className = "field-backdrop ministry-backdrop";
      backdrop.style.left = `${left}px`;
      backdrop.style.top = `${top}px`;
      backdrop.style.width = `${width}px`;
      backdrop.style.height = `${height}px`;

      annotationLayer.appendChild(backdrop);
      annotationLayer.appendChild(input);
    });
  };

  const renderPage = async (pageNumber, token) => {
    const page = await state.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: state.scale });

    const pageWrapper = document.createElement("div");
    pageWrapper.className = "page";
    pageWrapper.style.width = `${viewport.width}px`;
    pageWrapper.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    pageWrapper.appendChild(canvas);

    const annotationLayer = document.createElement("div");
    annotationLayer.className = "annotation-layer";
    pageWrapper.appendChild(annotationLayer);

    elements.root.appendChild(pageWrapper);

    await page.render({
      canvasContext: context,
      viewport,
      annotationMode: pdfjsLib.AnnotationMode ? pdfjsLib.AnnotationMode.DISABLE : 0,
    }).promise;

    if (token !== state.renderToken) return;

    const annotations = await page.getAnnotations({ intent: "display" });
    annotations
      .filter((annotation) => annotation.subtype === "Widget")
      .forEach((annotation) => {
        annotation.pageNumber = pageNumber;
        createWidget(annotation, viewport, pageWrapper, pageNumber);
      });
  };

  const groupRows = (fields) => {
    if (!fields.length) return [];
    const sorted = [...fields].sort((a, b) => b.centerY - a.centerY);
    const tolerance = 14;
    const rows = [];
    sorted.forEach((field) => {
      const lastRow = rows[rows.length - 1];
      if (!lastRow || Math.abs(field.centerY - lastRow.centerY) > tolerance) {
        rows.push({ centerY: field.centerY, items: [field] });
      } else {
        lastRow.items.push(field);
      }
    });
    rows.forEach((row) => {
      row.items.sort((a, b) => a.centerX - b.centerX);
    });
    return rows;
  };

  const buildMirrorMap = () => {
    state.mirrorMap = Object.create(null);
    if (!state.annotationsByPage[1] || !state.annotationsByPage[2]) return;

    const byName = (fields, keyword) =>
      fields
        .filter((field) => String(field.fieldName || "").toLowerCase().includes(keyword))
        .map((field) => ({
          ...field,
          centerX: (field.rect[0] + field.rect[2]) / 2,
          centerY: (field.rect[1] + field.rect[3]) / 2,
        }));

    const frontFirst = byName(state.annotationsByPage[1], "first");
    const backFirst = byName(state.annotationsByPage[2], "first");
    const frontLast = byName(state.annotationsByPage[1], "last");
    const backLast = byName(state.annotationsByPage[2], "last");

    const applyMirror = (frontFields, backFields) => {
      const frontRows = groupRows(frontFields);
      const backRows = groupRows(backFields);
      const rowCount = Math.min(frontRows.length, backRows.length);
      for (let i = 0; i < rowCount; i += 1) {
        const frontRow = frontRows[i].items;
        const backRow = backRows[i].items;
        const count = Math.min(frontRow.length, backRow.length);
        for (let j = 0; j < count; j += 1) {
          const frontField = frontRow[j];
          const backField = backRow[count - 1 - j];
          if (frontField?.fieldName && backField?.fieldName) {
            state.mirrorMap[frontField.fieldName] = backField.fieldName;
          }
        }
      }
    };

    applyMirror(frontFirst, backFirst);
    applyMirror(frontLast, backLast);
    const mirrorKeys = Object.keys(state.mirrorMap);
    if (mirrorKeys.length) {
      console.info("Mirror map created:", state.mirrorMap);
    } else {
      console.warn("No mirror map created. Check field names or layout.");
    }
  };

  const collectAnnotations = async (pageNumber) => {
    const page = await state.pdfDoc.getPage(pageNumber);
    const annotations = await page.getAnnotations({ intent: "display" });
    const widgets = annotations.filter((annotation) => annotation.subtype === "Widget");
    widgets.forEach((annotation) => {
      if (annotation.fieldType !== "Tx") return;
      if (!state.annotationsByPage[pageNumber]) {
        state.annotationsByPage[pageNumber] = [];
      }
      state.annotationsByPage[pageNumber].push({
        fieldName: annotation.fieldName,
        fieldType: annotation.fieldType,
        rect: annotation.rect,
        textAlignment: annotation.textAlignment,
        textSize: annotation.textSize,
        pageNumber,
      });
    });
  };

  const renderAllPages = async () => {
    if (!state.pdfDoc) return;
    const token = ++state.renderToken;

    elements.root.innerHTML = "";
    state.annotationIds = [];
    state.fieldMeta = Object.create(null);
    state.annotationsByPage = Object.create(null);
    state.mirrorMap = Object.create(null);

    const firstPage = await state.pdfDoc.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    const availableWidth = Math.min(elements.root.clientWidth, 980) - 8;
    state.scale = Math.min(Math.max(availableWidth / baseViewport.width, 0.8), 1.6);

    if (token !== state.renderToken) return;
    await renderPage(1, token);
    await collectAnnotations(1);

    const pageWrapper = elements.root.querySelector(".page");
    if (pageWrapper) {
      const viewport = firstPage.getViewport({ scale: state.scale });
      createMinistryFields(viewport, pageWrapper);
    }

    if (state.pdfDoc.numPages >= 2) {
      await collectAnnotations(2);
    }

    buildMirrorMap();
  };

  const loadPdf = async () => {
    try {
      setStatus("Loading template…");
      setBusy(true);
      const response = await fetch(TEMPLATE_URL);
      if (!response.ok) {
        throw new Error("Template PDF not found.");
      }
      const buffer = await response.arrayBuffer();
      state.pdfBytes = new Uint8Array(buffer);
      state.pdfDoc = await pdfjsLib.getDocument({ data: copyPdfBytes() }).promise;
      state.annotationStorage = state.pdfDoc.annotationStorage;

      await renderAllPages();
      const fieldNames = Object.keys(state.fieldValues);
      if (fieldNames.length) {
        console.info("Detected PDF fields:", fieldNames);
      }
      setStatus("Ready to edit");
    } catch (error) {
      showError(error.message || "Unable to load PDF.");
      setStatus("Load failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadFlattened = async () => {
    if (!PDFDocument) {
      showError("PDF-lib failed to load. Please refresh.");
      return;
    }
    try {
      setBusy(true);
      setStatus("Rendering flattened PDF…");

      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      const srcDoc = await pdfjsLib.getDocument({ data: copyPdfBytes() }).promise;
      const outDoc = await PDFDocument.create();
      const rasterScale = 2.6;

      const drawFieldsForPage = (ctx, viewport, pageNumber) => {
        const fields = state.annotationsByPage[pageNumber] || [];
        fields.forEach((field) => {
          const value = state.fieldValues[field.fieldName];
          if (value === undefined || value === null || value === "") return;

          const rect = viewport.convertToViewportRectangle(field.rect);
          const left = Math.min(rect[0], rect[2]);
          const top = Math.min(rect[1], rect[3]);
          const width = Math.abs(rect[0] - rect[2]);
          const height = Math.abs(rect[1] - rect[3]);
          const style = getFieldStyle(field.fieldName);

          const fontSize = style.fontSize
            ? style.fontSize * viewport.scale
            : field.textSize
              ? field.textSize * viewport.scale
              : height * 0.6;
          const weight = style.weight === "black" ? 800 : 300;
          const color = style.color || "#1d1a17";
          const padding = Math.min(height * 0.15, 8);

          ctx.save();
          ctx.font = `${weight} ${fontSize}px Gotham, Helvetica Neue, sans-serif`;
          ctx.fillStyle = color;
          if (field.textAlignment === 1) {
            ctx.textAlign = "center";
          } else if (field.textAlignment === 2) {
            ctx.textAlign = "right";
          } else {
            ctx.textAlign = "left";
          }
          ctx.textBaseline = "middle";

          let x = left + padding;
          if (ctx.textAlign === "center") {
            x = left + width / 2;
          } else if (ctx.textAlign === "right") {
            x = left + width - padding;
          }
          const y = top + height / 2;

          const text = String(value);
          ctx.fillText(text, x, y, width - padding * 2);
          ctx.restore();
        });
      };

      const drawMinistryFields = (ctx, viewport, pageNumber) => {
        if (!state.ministryPositions.length) return;

        const firstNameFields = (state.annotationsByPage[1] || []).filter((f) =>
          String(f.fieldName || "").toLowerCase().includes("first")
        );
        const cols = new Set();
        firstNameFields.forEach((f) => cols.add(Math.round((f.rect[0] + f.rect[2]) / 2)));
        const sortedCols = [...cols].sort((a, b) => a - b);
        const numCols = sortedCols.length || 1;

        state.ministryPositions.forEach((pos) => {
          const value = state.ministryValues[pos.index];
          if (!value || !value.trim()) return;

          let pdfRect = pos.pdfRect;
          if (pageNumber === 2 && numCols > 1) {
            const field = firstNameFields[pos.index];
            if (!field) return;
            const fieldCenterX = (field.rect[0] + field.rect[2]) / 2;
            const colIdx = sortedCols.indexOf(
              sortedCols.reduce((prev, curr) =>
                Math.abs(curr - fieldCenterX) < Math.abs(prev - fieldCenterX) ? curr : prev
              )
            );
            const mirrorColIdx = numCols - 1 - colIdx;
            const mirrorCenterX = sortedCols[mirrorColIdx];
            const halfWidth = (pdfRect[2] - pdfRect[0]) / 2;
            pdfRect = [
              mirrorCenterX - halfWidth,
              pdfRect[1],
              mirrorCenterX + halfWidth,
              pdfRect[3],
            ];
          }

          const rect = viewport.convertToViewportRectangle(pdfRect);
          const left = Math.min(rect[0], rect[2]);
          const top = Math.min(rect[1], rect[3]);
          const width = Math.abs(rect[0] - rect[2]);
          const height = Math.abs(rect[1] - rect[3]);
          const style = getFieldStyle("ministry");

          let fontSize = (style.fontSize || 11) * viewport.scale;
          const text = value.trim().toUpperCase();

          ctx.save();
          ctx.font = `300 ${fontSize}px Gotham, Helvetica Neue, sans-serif`;
          if (typeof ctx.letterSpacing !== "undefined") {
            ctx.letterSpacing = `${(style.letterSpacing || 4) * viewport.scale}px`;
          }

          const measured = ctx.measureText(text);
          if (measured.width > width * 0.9) {
            fontSize *= (width * 0.9) / measured.width;
            ctx.font = `300 ${fontSize}px Gotham, Helvetica Neue, sans-serif`;
          }

          ctx.fillStyle = style.color || "#a8ccd5";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, left + width / 2, top + height / 2, width * 0.95);
          ctx.restore();
        });
      };

      for (let pageNumber = 1; pageNumber <= srcDoc.numPages; pageNumber += 1) {
        const page = await srcDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: rasterScale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d", { alpha: false });

        await page.render({
          canvasContext: ctx,
          viewport,
          annotationMode: pdfjsLib.AnnotationMode ? pdfjsLib.AnnotationMode.DISABLE : 0,
        }).promise;

        drawFieldsForPage(ctx, viewport, pageNumber);
        drawMinistryFields(ctx, viewport, pageNumber);

        const pngBytes = toUint8Array(canvas.toDataURL("image/png"));
        const pngImage = await outDoc.embedPng(pngBytes);
        const pdfPage = outDoc.addPage([viewport.width, viewport.height]);
        pdfPage.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
        });
      }

      const bytes = await outDoc.save();
      downloadBytes(bytes, "TCC-Lanyards-flattened.pdf");
      setStatus("Download ready");
    } catch (error) {
      showError(error.message || "Unable to flatten PDF.");
      setStatus("Download failed");
    } finally {
      setBusy(false);
    }
  };

  elements.downloadFlattened.addEventListener("click", downloadFlattened);
  elements.reset.addEventListener("click", resetFields);

  window.addEventListener(
    "resize",
    debounce(() => {
      renderAllPages();
    }, 250)
  );

  loadPdf();
})();
