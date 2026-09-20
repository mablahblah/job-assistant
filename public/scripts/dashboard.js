// public/scripts/dashboard.js
// Tab switching, work log week navigation and the hide unjudged switch —
// vanilla JS, no dependencies

document.addEventListener("DOMContentLoaded", function () {
  // --- Tab switching ---
  var tabs = document.querySelectorAll("[data-tab]");
  var panels = document.querySelectorAll("[data-panel]");
  // Parts of the page that belong to one tab only, such as the hide switch.
  var tabOnly = document.querySelectorAll("[data-shows-on]");

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var target = tab.getAttribute("data-tab");

      tabs.forEach(function (t) {
        t.classList.remove("tab-nav-item-active");
      });
      tab.classList.add("tab-nav-item-active");

      panels.forEach(function (p) {
        p.classList.toggle("is-hidden", p.getAttribute("data-panel") !== target);
      });

      tabOnly.forEach(function (el) {
        el.classList.toggle("is-hidden", el.getAttribute("data-shows-on") !== target);
      });
    });
  });

  // --- Work log week switching ---
  var weekButtons = document.querySelectorAll("[data-week]");
  var weekSections = document.querySelectorAll("[data-week-content]");

  weekButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-week");

      weekButtons.forEach(function (b) {
        b.classList.remove("work-log-sidebar-item--active");
      });
      btn.classList.add("work-log-sidebar-item--active");

      weekSections.forEach(function (s) {
        s.classList.toggle("is-hidden", s.getAttribute("data-week-content") !== target);
      });
    });
  });

  // --- Hide unjudged switch ---
  var STORAGE_KEY = "hideUnjudged";
  var toggle = document.querySelector("[data-unjudged-toggle]");

  if (toggle) {
    // The server already tagged the unjudged rows, so this only hides and
    // shows them.
    var applyHide = function (hide) {
      document.querySelectorAll("[data-panel='backlog'] tr[data-unjudged]").forEach(function (row) {
        row.classList.toggle("is-hidden", hide);
      });

      // A backlog with every row hidden must not read as empty, so the table
      // gives way to a message saying no judged jobs remain.
      var nothingLeft =
        hide &&
        document.querySelectorAll("[data-panel='backlog'] tbody tr:not(.is-hidden)").length === 0;
      var message = document.querySelector("[data-all-hidden-message]");
      var table = document.querySelector("[data-panel='backlog'] .table-container");
      if (message) message.classList.toggle("is-hidden", !nothingLeft);
      if (table) table.classList.toggle("is-hidden", nothingLeft);
    };

    // Storage can be blocked, and the switch still has to work for this visit.
    // Nothing stored means a first visit, so the switch starts off and every
    // job shows.
    var stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}
    toggle.checked = stored === "true";
    applyHide(toggle.checked);

    toggle.addEventListener("change", function () {
      applyHide(toggle.checked);
      try {
        localStorage.setItem(STORAGE_KEY, String(toggle.checked));
      } catch (e) {}
    });
  }
});
