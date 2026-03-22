export function renderQualitySelector(selected = "original") {
    const options = [
        { value: "original", label: "Original" },
        { value: "1080p", label: "Full HD 1080p" },
        { value: "720p", label: "HD 720p" },
        { value: "480p", label: "SD 480p" }
    ];

    return `
    <label for="quality-select" style="display:block; margin-top:14px; margin-bottom:8px; color: var(--muted);">
      Playback quality
    </label>
    <select id="quality-select" class="quality-select">
      ${options
        .map(
            (option) => `
            <option value="${option.value}" ${option.value === selected ? "selected" : ""}>
              ${option.label}
            </option>
          `
        )
        .join("")}
    </select>
  `;
}