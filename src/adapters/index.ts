import { getLimits } from '@/config/limits';
import { getCostGuard } from '@/guard';
import type { GeocodingProvider } from '@/ports/geocoding';
import type { PlacesProvider } from '@/ports/places';
import type { WeatherProvider } from '@/ports/weather';
import { OpenMeteoGeocoder } from './geocoding/open-meteo';
import { CachedPlacesProvider, FallbackPlacesProvider } from './places/composite';
import { GooglePlacesProvider } from './places/google';
import { OsmPlacesProvider } from './places/osm';
import { OpenMeteoProvider } from './weather/open-meteo';

let places: PlacesProvider | undefined;
let weather: WeatherProvider | undefined;
let geocoder: GeocodingProvider | undefined;

export function getPlacesProvider(): PlacesProvider {
  if (!places) {
    const osm = new OsmPlacesProvider();
    const key = process.env.GOOGLE_PLACES_API_KEY;
    const useGoogle = getLimits().places.provider === 'google' && Boolean(key);
    places = new CachedPlacesProvider(
      useGoogle
        ? new FallbackPlacesProvider(new GooglePlacesProvider(key!, getCostGuard()), osm)
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
