import { getLimits } from '@/config/limits';
import { getCostGuard } from '@/guard';
import type { GeocodingProvider } from '@/ports/geocoding';
import type { PlaceDetailsProvider, PlacesProvider } from '@/ports/places';
import type { WeatherProvider } from '@/ports/weather';
import { OpenMeteoGeocoder } from './geocoding/open-meteo';
import {
  CachedPlacesProvider,
  CircuitBreakerPlacesProvider,
  FallbackPlacesProvider,
  RoutingPlacesProvider,
} from './places/composite';
import { GooglePlacesProvider } from './places/google';
import { OsmPlacesProvider } from './places/osm';
import { OpenMeteoProvider } from './weather/open-meteo';

let places: PlacesProvider | undefined;
let weather: WeatherProvider | undefined;
let geocoder: GeocodingProvider | undefined;

export function getPlacesProvider(): PlacesProvider {
  if (!places) {
    const osm = new CircuitBreakerPlacesProvider(new OsmPlacesProvider());
    const key = process.env.GOOGLE_PLACES_API_KEY;
    const useGoogle = getLimits().places.provider === 'google' && Boolean(key);
    places = new CachedPlacesProvider(
      useGoogle
        ? (() => {
            const google = new GooglePlacesProvider(key!, getCostGuard());
            return new RoutingPlacesProvider(
              new FallbackPlacesProvider(google, osm),
              // Free ideas try OSM first; Google answers when Overpass is slow or rate-limited.
              new FallbackPlacesProvider(osm, google),
            );
          })()
        : osm,
    );
  }
  return places;
}

export function getWeatherProvider(): WeatherProvider {
  weather ??= new OpenMeteoProvider();
  return weather;
}

export function getGeocoder(): GeocodingProvider {
  geocoder ??= new OpenMeteoGeocoder();
  return geocoder;
}

/** Null when Google is not configured; OSM places are stored in full and need no re-fetch. */
export function getPlaceDetailsProvider(): PlaceDetailsProvider | null {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (getLimits().places.provider !== 'google' || !key) return null;
  return new GooglePlacesProvider(key, getCostGuard());
}
