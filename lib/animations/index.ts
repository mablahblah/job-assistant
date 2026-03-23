// Central export for all Lottie animation data used by the scraper terminal UI
import type { Animation } from "react-useanimations/utils/constants";
import loadingData from "./loading.json";
import refreshData from "./refresh.json";
import maximizeMinimizeData from "./maximizeMinimize.json";
import filterData from "./filter.json";
import editData from "./edit.json";

// Cast to Animation so react-useanimations accepts our custom Lottie JSONs
export const loading = { animationData: loadingData, animationKey: "loading" } as unknown as Animation;
export const refresh = { animationData: refreshData, animationKey: "refresh" } as unknown as Animation;
export const maximizeMinimize = { animationData: maximizeMinimizeData, animationKey: "maximizeMinimize" } as unknown as Animation;
export const filter = { animationData: filterData, animationKey: "filter" } as unknown as Animation;
export const edit = { animationData: editData, animationKey: "edit" } as unknown as Animation;
