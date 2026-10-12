/** Provider-neutral venue types; every adapter maps these to its own categories. */
export const PLACE_TYPES = [
  'miniature_golf',
  'cinema',
  'bowling',
  'museum',
  'gallery',
  'theatre',
  'restaurant',
  'cafe',
  'ice_cream',
  'bar',
  'beer_garden',
  'climbing',
  'swimming',
  'thermal_bath',
  'bathing_lake',
  'escape_room',
  'zoo',
  'theme_park',
  'ice_rink',
  'karting',
  'trampoline',
  'viewpoint',
  'park',
  'riverside',
  'library',
  'bookshop',
  'church',
  'marketplace',
  'mall',
  'mountain_hut',
] as const;

export type PlaceType = (typeof PLACE_TYPES)[number];

/** Venue found by its search term only (Google text search), e.g. ideas saved from a search. */
export const TEXT_SEARCH_TYPE = 'custom';
