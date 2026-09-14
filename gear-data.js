/* gear-data.js — structure of the gear checklist (IDs map to i18n keys gear.item.<id>) */
const GEAR_COMMON = {
  bike: ["bike1","bike2","bike3","bike4","bike5","bike6","bike7","bike8","bike9","bike10"],
  luggage: ["luggage1","luggage2","luggage3","luggage4","luggage5","luggage6"],
  nav: ["nav1","nav2","nav3","nav4","nav5","nav6","nav7","nav8","nav9"],
  camp: ["camp1","camp2","camp3","camp4","camp5","camp6","camp7","camp8"],
  clothing: ["clothing1","clothing2","clothing3","clothing4","clothing5","clothing6","clothing7","clothing8","clothing9","clothing10"],
  hygiene: ["hygiene1","hygiene2","hygiene3","hygiene4","hygiene5","hygiene6","hygiene7","hygiene8","hygiene9","hygiene10","hygiene11"],
  food: ["food1","food2","food3","food4","food5","food6","food7","food8","food9","food10","food11","food12","food13","food14"],
  docs: ["docs1","docs2","docs3","docs4","docs5","docs6"],
  personal: ["personal1","personal2","personal3"],
};

const GEAR_CONDITIONAL = {
  hot: ["hot1","hot2","hot3","hot4","hot5"],
  cold: ["cold1","cold2","cold3","cold4","cold5"],
  rain: ["rain1","rain2","rain3","rain4","rain5","rain6"],
  wind: ["wind1","wind2","wind3"],
  technical: ["tech1","tech2","tech3"],
};

const GEAR_CATEGORY_ORDER = ["bike","luggage","nav","camp","clothing","hygiene","food","docs","personal"];
const GEAR_CONDITIONAL_ORDER = ["hot","cold","rain","wind","technical"];
