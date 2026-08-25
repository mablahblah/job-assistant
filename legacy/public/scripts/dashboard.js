// public/scripts/dashboard.js
// Tab switching and work log week navigation — vanilla JS, no dependencies

document.addEventListener("DOMContentLoaded", function () {
  // --- Tab switching ---
  var tabs = document.querySelectorAll("[data-tab]");
  var panels = document.querySelectorAll("[data-panel]");

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var target = tab.getAttribute("data-tab");

      // update active tab style
      tabs.forEach(function (t) {
        t.classList.remove("tab-nav-item-active");
      });
      tab.classList.add("tab-nav-item-active");

      // show target panel, hide others
      panels.forEach(function (p) {
        p.style.display =
          p.getAttribute("data-panel") === target ? "" : "none";
      });
    });
  });

  // --- Work log week switching ---
  var weekButtons = document.querySelectorAll("[data-week]");
  var weekSections = document.querySelectorAll("[data-week-content]");

  weekButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-week");

      // update active sidebar item
      weekButtons.forEach(function (b) {
        b.classList.remove("work-log-sidebar-item--active");
      });
      btn.classList.add("work-log-sidebar-item--active");

      // show target week, hide others
      weekSections.forEach(function (s) {
        s.style.display =
          s.getAttribute("data-week-content") === target ? "" : "none";
      });
    });
  });
});
