"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { HeroMarketCard } from "@/components/market/hero-market-card";
import { SpeedHeroCard, SpeedHeroCardSkeleton } from "@/components/speed/speed-hero-card";
import { cn, triggerHaptic } from "@/lib/utils";
import type { MarketWithAmm } from "@/types/market";
import type { Side, SpeedMarket } from "@/types/database";

const MAX_SLIDES = 4;
const AUTOPLAY_MS = 6500;

type CarouselSlide =
  | { type: "speed"; market: SpeedMarket }
  | { type: "speed-skeleton" }
  | { type: "prediction"; market: MarketWithAmm };

interface FeaturedMarketsCarouselProps {
  markets: MarketWithAmm[];
  speedMarket?: SpeedMarket | null;
  /** True while the speed-market hook is still in flight on cold load. */
  speedMarketLoading?: boolean;
  onTradeClick?: (market: MarketWithAmm, side: Side) => void;
}

export function FeaturedMarketsCarousel({
  markets,
  speedMarket,
  speedMarketLoading = false,
  onTradeClick,
}: FeaturedMarketsCarouselProps) {
  const tHero = useTranslations("hero");
  // Slot 0 is reserved for the speed market. Real card when loaded,
  // skeleton card while loading. Either way, prediction markets fill the
  // remaining slots — they never bump up to slot 0 mid-paint.
  const speedSlot: CarouselSlide | null = speedMarket
    ? { type: "speed" as const, market: speedMarket }
    : speedMarketLoading
      ? { type: "speed-skeleton" as const }
      : null;
  const slides: CarouselSlide[] = speedSlot
    ? [
        speedSlot,
        ...markets.slice(0, MAX_SLIDES - 1).map((m) => ({ type: "prediction" as const, market: m })),
      ]
    : markets.slice(0, MAX_SLIDES).map((m) => ({ type: "prediction" as const, market: m }));
  const trackRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [animationTick, setAnimationTick] = useState(0);
  const autoplayStoppedRef = useRef(false);
  const scrollEndTimerRef = useRef<number | null>(null);

  // Detect prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Clamp currentIndex when the markets list shrinks (realtime removal)
  useEffect(() => {
    if (currentIndex >= slides.length && slides.length > 0) {
      setCurrentIndex(slides.length - 1);
    }
  }, [slides.length, currentIndex]);

  // Bump animation tick each time the active slide changes so the active
  // card's chart remounts and replays its draw-in animation.
  useEffect(() => {
    setAnimationTick((n) => n + 1);
  }, [currentIndex]);

  const scrollToIndex = useCallback((idx: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({
      left: idx * track.clientWidth,
      behavior: "smooth",
    });
  }, []);

  const stopAutoplay = useCallback(() => {
    autoplayStoppedRef.current = true;
  }, []);

  // Autoplay — advance every 6.5s. Stopped permanently on first user interaction.
  useEffect(() => {
    if (reducedMotion || slides.length < 2) return;
    const interval = window.setInterval(() => {
      if (autoplayStoppedRef.current) return;
      const track = trackRef.current;
      if (!track) return;
      const next = (currentIndex + 1) % slides.length;
      track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
    }, AUTOPLAY_MS);
    return () => window.clearInterval(interval);
  }, [currentIndex, reducedMotion, slides.length]);

  // Track current index — debounced to scroll-end so React doesn't
  // re-render mid-swipe (that's what made the native feel janky).
  const onScroll = useCallback(() => {
    if (scrollEndTimerRef.current != null) {
      window.clearTimeout(scrollEndTimerRef.current);
    }
    scrollEndTimerRef.current = window.setTimeout(() => {
      const track = trackRef.current;
      if (!track || track.clientWidth === 0) return;
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      const clamped = Math.max(0, Math.min(idx, slides.length - 1));
      setCurrentIndex((prev) => (prev === clamped ? prev : clamped));
    }, 120);
  }, [slides.length]);

  useEffect(() => {
    return () => {
      if (scrollEndTimerRef.current != null) window.clearTimeout(scrollEndTimerRef.current);
    };
  }, []);

  if (slides.length === 0) return null;

  // Single-slide case: just render the card, no chrome.
  if (slides.length === 1) {
    const only = slides[0];
    if (only.type === "speed") return <SpeedHeroCard market={only.market} />;
    if (only.type === "speed-skeleton") return <SpeedHeroCardSkeleton />;
    return (
      <HeroMarketCard
        market={only.market}
        onTradeClick={onTradeClick ? (side) => onTradeClick(only.market, side) : undefined}
        animateChart={!reducedMotion}
        animationKey={animationTick}
      />
    );
  }

  const atStart = currentIndex <= 0;
  const atEnd = currentIndex >= slides.length - 1;

  const handlePrev = () => {
    stopAutoplay();
    triggerHaptic();
    scrollToIndex(Math.max(0, currentIndex - 1));
  };

  const handleNext = () => {
    stopAutoplay();
    triggerHaptic();
    scrollToIndex(Math.min(slides.length - 1, currentIndex + 1));
  };

  const handleDotClick = (idx: number) => {
    stopAutoplay();
    scrollToIndex(idx);
  };

  return (
    <div className="w-full">
      <div
        ref={trackRef}
        onScroll={onScroll}
        onTouchStart={stopAutoplay}
        onWheel={stopAutoplay}
        dir="ltr"
        className="flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [-webkit-overflow-scrolling:touch] [touch-action:pan-x_pan-y] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        aria-roledescription="carousel"
        aria-label={tHero("primaryMarket")}
      >
        {slides.map((slide, idx) => {
          const slideKey =
            slide.type === "speed-skeleton"
              ? `${idx}-speed-skeleton`
              : `${idx}-${slide.market.id}`;
          return (
            <div
              key={slideKey}
              className="w-full shrink-0 snap-center px-0.5"
              aria-roledescription="slide"
              aria-label={`${idx + 1} / ${slides.length}`}
              aria-hidden={idx !== currentIndex}
            >
              {slide.type === "speed" ? (
                <SpeedHeroCard market={slide.market} />
              ) : slide.type === "speed-skeleton" ? (
                <SpeedHeroCardSkeleton />
              ) : (
                <HeroMarketCard
                  market={slide.market}
                  onTradeClick={onTradeClick ? (side) => onTradeClick(slide.market, side) : undefined}
                  animateChart={!reducedMotion && idx === currentIndex}
                  animationKey={idx === currentIndex ? animationTick : undefined}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Controls row — tight premium cluster */}
      <div className="mt-5 flex items-center justify-center">
        <button
          type="button"
          onClick={handlePrev}
          disabled={atStart}
          aria-label={tHero("previous")}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-custom transition-all",
            "hover:bg-elevated hover:text-text active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-custom",
            "[-webkit-tap-highlight-color:transparent]",
          )}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
        </button>

        <div className="flex items-center">
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleDotClick(idx)}
              aria-label={tHero("goToSlide", { index: idx + 1 })}
              aria-current={idx === currentIndex}
              className="flex h-8 w-5 items-center justify-center [-webkit-tap-highlight-color:transparent]"
            >
              <span
                className={cn(
                  "block h-2 w-2 rounded-full transition-all",
                  idx === currentIndex
                    ? "bg-yes scale-110"
                    : "bg-muted-custom/40 group-hover:bg-muted-custom/70",
                )}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleNext}
          disabled={atEnd}
          aria-label={tHero("next")}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-custom transition-all",
            "hover:bg-elevated hover:text-text active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-custom",
            "[-webkit-tap-highlight-color:transparent]",
          )}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
