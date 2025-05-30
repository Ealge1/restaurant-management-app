// app/api/arbitrage/route.ts
import { type NextRequest, NextResponse } from "next/server";
// No axios import needed

const BASE_URL = "api.the-odds-api.com/v4";
const PROTOCOL = "https://";

// --- Interfaces ---
interface Outcome {
  name: string;
  price: number;
  point?: number; // Added for player props
  dunkel_id?: string; // Optional: based on v4 docs, might exist for some markets
}

interface Market {
  key: string;
  last_update: number;
  outcomes: Outcome[];
  // bookmakerTitle is added temporarily during processing, not part of original API response
  bookmakerTitle?: string;
}

interface Bookmaker {
  key: string;
  title: string;
  last_update: number;
  markets: Market[];
}

interface MatchData {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string; // ISO 8601 format string
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

interface Sport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

// Helper type to distinguish market types for processing
export type MarketType = "h2h" | "player_prop" | "other";

// Interface for the best odds found for each outcome within a specific market instance
interface BestOutcomeOdds {
  [outcomeIdentifier: string]: {
    // Use outcomeIdentifier as key (e.g., "Over_5.5", "Home")
    bookmaker: string;
    odd: number;
    point?: number; // Include point for player props
    originalOutcomeName: string; // Store the original outcome name (e.g., "Over")
  };
}

export interface ArbitrageOpportunity {
  id: string; // Add match ID for better keying
  match_name: string;
  match_start_time_iso: string; // Keep ISO for easier client formatting
  league: string;
  market_key: string; // Key of the market (e.g., 'h2h', 'player_points')
  market_type: MarketType; // Categorize market type
  market_description?: string; // e.g., "LeBron James - Total Points" for player props
  best_outcome_odds: BestOutcomeOdds; // Renamed to reflect it's best odds per identified outcome
  total_implied_odds: number;
  arbitrage_percentage: number;
  outcomes_details: OutcomeDetail[];
  total_return_for_100_stake: number;
}

export interface OutcomeDetail {
  outcome_name: string; // The display name for the outcome (e.g., "Over 25.5 Points")
  bookmaker: string;
  odds: number;
  stake: number;
  return_amount: number;
}

// --- Helper Functions (Adapted for fetch) ---

const handleApiError = async (response: Response) => {
  // fetch only throws on network errors, so we check response.ok
  const status = response.status;
  let message = `API Error (Status: ${status})`;
  try {
    // Try to parse the error message from the API response body
    const errorData = await response.json();
    // Prefer API's message, fallback to a default based on status
    if (
      errorData &&
      typeof errorData.message === "string" &&
      errorData.message.length > 0
    ) {
      message = errorData.message;
    } else {
      message = `API Error (Status: ${status}): ${
        response.statusText || "Unknown Error"
      }`;
    }
  } catch (e) {
    // Ignore if parsing fails, use the status code message
    console.warn("Could not parse error response body:", e);
    message = `API Error (Status: ${status}): ${
      response.statusText || "Unknown Error"
    }`;
  }

  // Throw specific errors for common API issues
  if (status === 401) {
    // SECURITY WARNING: Returning detailed API errors like this can leak information.
    // In a production app, consider logging the detailed error on the server
    // and returning a more generic "Authentication failed" message to the client.
    throw new Error(`API Authentication Failed: ${message}`);
  } else if (status === 429) {
    throw new Error(`API Rate Limit Exceeded: ${message}`);
  } else if (status >= 400 && status < 500) {
    // Client error (e.g., invalid sport/market, bad params)
    throw new Error(`API Request Error: ${message}`);
  } else {
    // Server-side API errors or other unhandled issues
    throw new Error(`API Server Error: ${message}`);
  }
};

const getSports = async (key: string): Promise<string[]> => {
  const url = new URL(`${PROTOCOL}${BASE_URL}/sports/`);
  url.searchParams.append("apiKey", key);

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      // Handle HTTP errors (like 4xx, 5xx)
      await handleApiError(response); // Throws specific error
    }

    const data = (await response.json()) as Sport[]; // Cast to Sport[]
    // Filter for active sports that likely have odds (optional but can reduce calls)
    return data.filter((sport) => sport.active).map((item) => item.key);
  } catch (error) {
    // Handle network errors or errors thrown by handleApiError
    console.error("Error fetching sports:", error);
    // Re-throw the error to be caught by the main handler
    throw error instanceof Error
      ? error
      : new Error("An unexpected error occurred while fetching sports.");
  }
};

const getOddsData = async (
  key: string,
  sport: string,
  region: string,
  markets: string[]
): Promise<MatchData[]> => {
  // Skip fetching if no markets are requested
  if (markets.length === 0) {
    console.log(
      `Skipping fetch for sport ${sport} as no markets were requested.`
    );
    return [];
  }

  const url = new URL(`${PROTOCOL}${BASE_URL}/sports/${sport}/odds/`);
  url.searchParams.append("apiKey", key);
  url.searchParams.append("regions", region);
  url.searchParams.append("oddsFormat", "decimal");
  url.searchParams.append("dateFormat", "iso");
  url.searchParams.append("markets", markets.join(",")); // Request multiple markets

  // Optionally add a parameter to include "outcomes" in the response
  // The documentation for v4 /odds doesn't explicitly mention an outcomes parameter
  // like v3, but the response structure includes them. If needed, check the latest docs.
  // url.searchParams.append("outcomes", "true"); // This might be needed depending on exact endpoint behavior

  try {
    console.log(
      `Attempting to fetch odds for sport ${sport}, region ${region}, markets ${markets.join(
        ","
      )}`
    );
    const response = await fetch(url.toString());

    if (!response.ok) {
      await handleApiError(response); // This will throw an error
    }

    const data = (await response.json()) as MatchData[];
    console.log(
      `Successfully fetched ${
        data.length
      } matches for sport ${sport}, markets ${markets.join(",")}`
    );
    return data;
  } catch (error) {
    console.error(
      `Error fetching odds for ${sport} with markets ${markets.join(",")}:`,
      error
    );
    // Catch and re-throw the error. The Promise.allSettled in the main handler
    // will catch this and mark the promise as 'rejected'.
    throw error instanceof Error
      ? error
      : new Error(
          `An unexpected error occurred while fetching odds for ${sport}.`
        );
  }
};

// --- Stake/Return Calculation Functions remain the same ---
const calculateStake = (
  impliedOddsList: number[],
  totalStake: number
): number[] => {
  const totalImplied = impliedOddsList.reduce((sum, odd) => sum + odd, 0);
  if (totalImplied <= 0) return impliedOddsList.map(() => 0); // Prevent division by zero or negative implied total
  // Ensure sum of stakes equals totalStake (with minor rounding tolerance)
  const stakes = impliedOddsList.map(
    (odd) => totalStake * (odd / totalImplied) // FIXED TYPO: totalImplplied -> totalImplied
  );
  const sumOfStakes = stakes.reduce((sum, stake) => sum + stake, 0);
  // Adjust stakes slightly if the sum isn't exactly totalStake due to floating point issues
  const adjustmentFactor = totalStake / sumOfStakes;
  const adjustedStakes = stakes.map(
    (stake) => Math.round(stake * adjustmentFactor * 100) / 100
  );

  // Final check and potential minor re-adjustment to ensure sum is exactly totalStake
  const finalSum = adjustedStakes.reduce((sum, stake) => sum + stake, 0);
  if (Math.abs(finalSum - totalStake) > 0.01) {
    // Tolerance of 1 cent
    const diff = totalStake - finalSum;
    // Add the difference to the largest stake
    const largestStakeIndex = adjustedStakes.indexOf(
      Math.max(...adjustedStakes)
    );
    adjustedStakes[largestStakeIndex] =
      Math.round((adjustedStakes[largestStakeIndex] + diff) * 100) / 100;
  }

  return adjustedStakes;
};

const calculateReturn = (stake: number, decimalOdds: number): number => {
  return Math.round(stake * decimalOdds * 100) / 100;
};

// --- Main API Route Logic (GET handler) ---
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const apiKey = searchParams.get("apiKey");
  const region = searchParams.get("region") || "eu";
  const cutoffPercent = parseFloat(searchParams.get("cutoff") || "0");
  const requestedMarkets = searchParams.get("markets")?.split(",") || ["h2h"]; // Get requested markets

  if (!apiKey) {
    return NextResponse.json(
      { message: "API key is required" },
      { status: 400 }
    );
  }

  const cutoff = cutoffPercent / 100; // Convert percentage to decimal

  // Define market prefixes to categorize market types
  const playerPropPrefixes = [
    "player_",
    "pitcher_",
    "bunting_",
    "fielding_",
    "passing_",
    "punting_",
    "receiving_",
    "rushing_",
    "scoring_",
    "tackles_assists_",
  ]; // Add more based on docs
  const h2hMarkets = ["h2h", "h2h_3_way"]; // Common head-to-head markets

  try {
    console.log("Fetching active sports...");
    const sportKeys = await getSports(apiKey);
    console.log(`Found ${sportKeys.length} active sports.`);

    const allMatchData: MatchData[] = [];
    // Fetch odds for requested markets for each active sport.
    // Use Promise.allSettled to allow some sports/markets to fail without stopping everything.
    const fetchPromises = sportKeys.flatMap((sportKey) =>
      // For each sport, create a fetch promise for each requested market
      requestedMarkets.map((marketKey) =>
        getOddsData(apiKey, sportKey, region, [marketKey])
          .then((data) => ({
            status: "fulfilled",
            value: data,
            sport: sportKey,
            market: marketKey,
          }))
          .catch((error) => ({
            status: "rejected",
            reason: error,
            sport: sportKey,
            market: marketKey,
          }))
      )
    );

    console.log(
      `Attempting to fetch odds for ${fetchPromises.length} sport-market combinations...`
    );
    const results = await Promise.allSettled(fetchPromises);

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        const value = result.value as {
          status: string;
          value: MatchData[];
          sport: string;
          market: string;
          reason?: any;
        };
        if (value && Array.isArray(value.value)) {
          allMatchData.push(...value.value);
        } else if (value && value.status === "rejected") {
          console.warn(
            `getOddsData promise was fulfilled but contained a rejection status for sport ${value.sport}, market ${value.market}:`,
            value.reason
          );
        }
      } else if (result.status === "rejected") {
        const reason = result.reason as {
          sport: string;
          market: string;
          reason?: any;
        };
        console.warn(
          `Promise to fetch odds was rejected for sport ${reason.sport}, market ${reason.market}:`,
          reason.reason || reason
        );
      }
    });

    console.log(
      `Received and will process data for ${allMatchData.length} matches across requested markets.`
    );
    const arbitrageOpportunities: ArbitrageOpportunity[] = [];

    // Group markets by a unique identifier for the specific market instance within a match.
    // For H2H, this is just match_id + market_key.
    // For player props (Over/Under), this is match_id + market_key + player_identifier + point.
    // Player identifier is tricky as API doesn't explicitly provide it. We might have to
    // infer it from outcome names or rely on the market key + point combination being unique enough.
    // Let's use match_id + market_key + point (if available).
    // Assuming outcome names like "Over 25.5" and "Under 25.5" within a market key like "player_points"
    // for a given match represent the same player's points market at that line.
    const marketsByMatchKeyAndPoint: Map<
      string,
      { match: MatchData; bookmakerTitle: string; market: Market }[]
    > = new Map();

    for (const match of allMatchData) {
      for (const bookmaker of match.bookmakers) {
        for (const market of bookmaker.markets) {
          // Create a key for this specific market instance
          // For Over/Under markets, outcomes have 'point'. Use the first outcome's point as part of the key.
          // This assumes all outcomes within a single Over/Under market for a bookmaker share the same point.
          // Need to be careful if a bookmaker lists multiple lines under one market key (less common in v4).
          const marketPointIdentifier =
            market.outcomes.length > 0 && market.outcomes[0].point !== undefined
              ? `_${market.outcomes[0].point}`
              : ""; // No point for markets like H2H

          const mapKey = `${match.id}-${market.key}${marketPointIdentifier}`;

          if (!marketsByMatchKeyAndPoint.has(mapKey)) {
            marketsByMatchKeyAndPoint.set(mapKey, []);
          }
          // Store the match context and bookmaker title along with the market
          marketsByMatchKeyAndPoint.get(mapKey)?.push({
            match: match,
            bookmakerTitle: bookmaker.title,
            market: market,
          });
        }
      }
    }

    console.log(
      `Processing ${marketsByMatchKeyAndPoint.size} distinct market instances...`
    );

    // Process each grouped market instance for arbitrage
    for (const [
      mapKey,
      marketInstances,
    ] of marketsByMatchKeyAndPoint.entries()) {
      if (marketInstances.length === 0) continue;

      const { match, market } = marketInstances[0]; // Use data from the first instance for match/market context
      const marketKey = market.key;

      const bestOddPerOutcome: BestOutcomeOdds = {};

      // Find the best odds for each outcome across all bookmakers for this market instance
      for (const { bookmakerTitle, market: currentMarket } of marketInstances) {
        if (!bookmakerTitle) continue; // Should not happen with how map is populated

        for (const outcome of currentMarket.outcomes) {
          const originalOutcomeName = outcome.name; // e.g., "Over", "Under", "Home", "Draw", "Away"
          const odd = outcome.price;
          const point = outcome.point; // e.g., 25.5

          if (odd === null || odd === undefined || odd <= 1.0) {
            // Ignore invalid odds (<= 1.0 implies >= 100% probability)
            continue;
          }

          // Create a unique identifier for the outcome considering its name and point
          const outcomeIdentifier =
            point !== undefined
              ? `${originalOutcomeName}_${point}` // e.g., "Over_25.5"
              : originalOutcomeName; // e.g., "Home"

          if (
            !bestOddPerOutcome[outcomeIdentifier] ||
            odd > bestOddPerOutcome[outcomeIdentifier].odd
          ) {
            bestOddPerOutcome[outcomeIdentifier] = {
              bookmaker: bookmakerTitle,
              odd: odd,
              point: point, // Keep point if it exists
              originalOutcomeName: originalOutcomeName, // Store original name
            };
          }
        }
      }

      // An arbitrage opportunity requires at least two valid outcomes with best odds found
      const uniqueOutcomesCount = Object.keys(bestOddPerOutcome).length;
      if (uniqueOutcomesCount < 2) {
        // A valid H2H or player prop Over/Under market should have exactly 2 outcomes.
        // A 3-way market (like Soccer H2H) should have 3. If we find less than 2
        // best odds, it's not a complete set for arbitrage for that market type.
        // console.warn(`Skipping potential arb for match ${match.id}, market ${marketKey} (point: ${market.outcomes[0]?.point ?? 'N/A'}) - only ${uniqueOutcomesCount} unique outcomes found with valid odds.`);
        continue;
      }

      // Calculate total implied odds from the best odds found
      const impliedOddsList = Object.values(bestOddPerOutcome).map(
        (details) => 1 / details.odd
      );
      const totalImpliedOdds = impliedOddsList.reduce(
        (sum, implied) => sum + implied,
        0
      );

      // Check for arbitrage condition: total implied odds < 1 (or 1 - cutoff)
      if (totalImpliedOdds > 0 && totalImpliedOdds < 1.0 - cutoff) {
        const arbitragePercentage = (1 - totalImpliedOdds) * 100;
        const matchName = `${match.home_team} vs ${match.away_team}`;
        const league = match.sport_title;

        // Determine Market Type and Description
        let marketType: MarketType = "other";
        let marketDescription: string | undefined = undefined;
        let outcomeDisplayNames: string[] = []; // Array to hold formatted outcome names for details

        if (h2hMarkets.includes(marketKey)) {
          marketType = "h2h";
          // H2H outcomes are typically "Home", "Draw", "Away"
          outcomeDisplayNames = Object.values(bestOddPerOutcome).map(
            (details) => details.originalOutcomeName
          );
        } else if (
          playerPropPrefixes.some((prefix) => marketKey.startsWith(prefix))
        ) {
          marketType = "player_prop";
          // For player props, the description should include player name and the line (point)
          // The Odds API v4 structure for player props often lists player name
          // within the outcome name itself (e.g., "LeBron James Over 25.5").
          // We'll use the outcomeIdentifier (e.g., "Over_25.5") and try to make it readable.

          // Attempt to extract player name from a sample outcome identifier
          const sampleOutcomeIdentifier = Object.keys(bestOddPerOutcome)[0]; // e.g., "LeBron James Over_25.5" or "Over_25.5"
          let playerName = "";
          let statType = marketKey
            .replace(
              playerPropPrefixes.find((prefix) =>
                marketKey.startsWith(prefix)
              ) || "",
              ""
            )
            .replace(/_/g, " "); // e.g., "points"

          // Simple regex to find "Player Name Over/Under Point" pattern in outcome name if available
          const playerPropOutcomeRegex = /(.+) (Over|Under)(?:_\d+\.?\d*)?/; // Capture player name
          const matchResult = sampleOutcomeIdentifier.match(
            playerPropOutcomeRegex
          );

          if (matchResult && matchResult[1]) {
            playerName = matchResult[1].trim();
            // Refine stat type parsing if player name found in outcome
            const statKeyPart = sampleOutcomeIdentifier
              .replace(`${playerName} `, "")
              .split("_")[0]; // e.g., "Over_25.5" -> "Over"
            statType = statKeyPart.replace(/_/g, " "); // Basic cleaning
          } else {
            // Fallback: just use the market key cleaned up
            statType = marketKey
              .replace(
                playerPropPrefixes.find((prefix) =>
                  marketKey.startsWith(prefix)
                ) || "",
                ""
              )
              .replace(/_/g, " ");
            // Try to get player name from parent match data if available (rare in API response structure)
            // Or assume the market key itself implies the player if it's sport-specific
            // For now, leave player name empty if not parsable from outcome.
          }

          marketDescription = `${
            playerName ? playerName + " - " : ""
          }${statType}${
            market.outcomes[0]?.point !== undefined
              ? ` (${market.outcomes[0].point})`
              : ""
          }`;

          // Format outcome names for display (e.g., "Over 25.5", "Under 25.5")
          outcomeDisplayNames = Object.entries(bestOddPerOutcome).map(
            ([identifier, details]) => {
              // Reconstruct display name from original name and point
              if (details.originalOutcomeName && details.point !== undefined) {
                return `${details.originalOutcomeName} ${details.point}`;
              } else if (details.originalOutcomeName) {
                return details.originalOutcomeName; // For H2H or other markets without points
              } else {
                return identifier; // Fallback
              }
            }
          );
        } else {
          marketType = "other";
          marketDescription = marketKey.replace(/_/g, " "); // Basic cleaning
          outcomeDisplayNames = Object.values(bestOddPerOutcome).map(
            (details) => details.originalOutcomeName
          );
        }

        const TOTAL_STAKE = 100; // Base stake for calculation display
        const stakes = calculateStake(impliedOddsList, TOTAL_STAKE);
        const outcomesDetails: OutcomeDetail[] = [];
        let calculatedTotalReturnFor100Stake = 0; // Will be the same for all outcomes in arb bet

        // Sort outcomes for consistent display order if possible (e.g., Home/Draw/Away or Over/Under)
        const sortedOutcomeEntries = Object.entries(bestOddPerOutcome).sort(
          ([, a], [, b]) => {
            // Simple sorting based on original name or point if available
            if (a.point !== undefined && b.point !== undefined) {
              return a.point - b.point; // Sort by point for over/under
            }
            // Basic alphabetical sort for others
            return a.originalOutcomeName.localeCompare(b.originalOutcomeName);
          }
        );

        sortedOutcomeEntries.forEach(([identifier, details], index) => {
          const stake = stakes[index];
          const returnAmount = calculateReturn(stake, details.odd);

          // Use the formatted display name for the outcome
          // Find the corresponding display name from the generated list
          const displayOutcomeName =
            outcomeDisplayNames[
              Object.keys(bestOddPerOutcome).indexOf(identifier) // Find the index of this identifier in the original order
            ] || identifier; // Fallback to identifier if display name not found (shouldn't happen)

          outcomesDetails.push({
            outcome_name: displayOutcomeName,
            bookmaker: details.bookmaker,
            odds: details.odd,
            stake: stake,
            return_amount: returnAmount,
          });

          // The return should be the same for all outcomes in a perfect arbitrage bet.
          // Take the return from one outcome as the total return for the €100 stake.
          // Since stakes are calculated to sum to 100, the return from any individual
          // outcome when staked according to the arb formula will be the total return.
          if (index === 0) {
            calculatedTotalReturnFor100Stake = returnAmount;
          } else {
            // Sanity check: ensure subsequent returns are very close
            if (
              Math.abs(returnAmount - calculatedTotalReturnFor100Stake) > 0.01
            ) {
              // console.warn(`Calculated return mismatch for match ${match.id}, market ${marketKey}. Expected ${calculatedTotalReturnFor100Stake.toFixed(2)}, got ${returnAmount.toFixed(2)}.`);
            }
          }
        });

        // Final check that sum of stakes is close to 100 (due to rounding)
        const sumStakes = outcomesDetails.reduce(
          (sum, detail) => sum + detail.stake,
          0
        );
        if (Math.abs(sumStakes - TOTAL_STAKE) > 0.01) {
          // console.warn(`Sum of stakes (${sumStakes.toFixed(2)}) not exactly ${TOTAL_STAKE} for match ${match.id}, market ${marketKey}.`);
          // This is handled by the calculateStake function now, but good to leave a log.
        }

        arbitrageOpportunities.push({
          id: match.id, // Include match ID
          match_name: matchName,
          match_start_time_iso: match.commence_time,
          league: league,
          market_key: marketKey,
          market_type: marketType,
          market_description: marketDescription,
          best_outcome_odds: bestOddPerOutcome, // This might not be strictly needed in the final client output structure, but useful for debugging/completeness
          total_implied_odds: totalImpliedOdds,
          arbitrage_percentage: arbitragePercentage,
          outcomes_details: outcomesDetails,
          total_return_for_100_stake: calculatedTotalReturnFor100Stake,
        });
      }
    }

    console.log(
      `Found ${arbitrageOpportunities.length} arbitrage opportunities.`
    );
    // Sort opportunities by arbitrage percentage descending
    arbitrageOpportunities.sort(
      (a, b) => b.arbitrage_percentage - a.arbitrage_percentage
    );

    return NextResponse.json(arbitrageOpportunities);
  } catch (error: any) {
    console.error("Error in API route:", error);
    // Return a standardized error response
    return NextResponse.json(
      { message: error.message || "Failed to fetch arbitrage opportunities" },
      {
        status:
          error.message.includes("API Authentication Failed") ||
          error.message.includes("API Rate Limit Exceeded") ||
          error.message.includes("API Request Error")
            ? 400
            : 500,
      } // Use 400 for client-side API errors (auth, rate limit, bad request), 500 for internal server errors
    );
  }
}
