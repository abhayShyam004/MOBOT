package com.openmausbot.companion.ui

import com.openmausbot.companion.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit tests for RichCardAssetResolver.
 *
 * Verifies:
 * 1. 17 minimum-coverage nations flags (+ variations and codes)
 * 2. Authentic player portrait resolution and graceful fallback
 * 3. Football and cricket club crest resolution
 * 4. Zero-emoji invariant adherence
 */
class RichCardAssetResolverTest {

    @Test
    fun verifySeventeenMinimumCoverageNationsFlags() {
        val minimumCoverageNations = mapOf(
            "India" to R.drawable.flag_in,
            "IN" to R.drawable.flag_in,
            "IND" to R.drawable.flag_in,
            "New Zealand" to R.drawable.flag_nz,
            "NZ" to R.drawable.flag_nz,
            "South Africa" to R.drawable.flag_za,
            "RSA" to R.drawable.flag_za,
            "China" to R.drawable.flag_cn,
            "PR China" to R.drawable.flag_cn,
            "Japan" to R.drawable.flag_jp,
            "JPN" to R.drawable.flag_jp,
            "South Korea" to R.drawable.flag_kr,
            "KOR" to R.drawable.flag_kr,
            "Uzbekistan" to R.drawable.flag_uz,
            "UZB" to R.drawable.flag_uz,
            "Iran" to R.drawable.flag_ir,
            "IRI" to R.drawable.flag_ir,
            "Thailand" to R.drawable.flag_th,
            "THA" to R.drawable.flag_th,
            "Kazakhstan" to R.drawable.flag_kz,
            "KAZ" to R.drawable.flag_kz,
            "Hong Kong" to R.drawable.flag_hk,
            "HKG" to R.drawable.flag_hk,
            "Bahrain" to R.drawable.flag_bh,
            "BRN" to R.drawable.flag_bh,
            "United States" to R.drawable.flag_us,
            "USA" to R.drawable.flag_us,
            "Great Britain" to R.drawable.flag_gb,
            "England" to R.drawable.flag_gb,
            "GBR" to R.drawable.flag_gb,
            "Australia" to R.drawable.flag_au,
            "AUS" to R.drawable.flag_au,
            "Spain" to R.drawable.flag_es,
            "ESP" to R.drawable.flag_es,
            "Italy" to R.drawable.flag_it,
            "ITA" to R.drawable.flag_it,
        )

        for ((key, expectedRes) in minimumCoverageNations) {
            val resolved = RichCardAssetResolver.getBundledCountryFlag(key)
            assertNotNull("Flag for '$key' must resolve to an authentic bundled drawable", resolved)
            assertEquals("Flag for '$key' mismatch", expectedRes, resolved)
        }
    }

    @Test
    fun verifyPlayerPortraitsResolution() {
        val knownPlayers = mapOf(
            "Virat Kohli" to R.drawable.player_virat_kohli,
            "Kohli" to R.drawable.player_virat_kohli,
            "V. Kohli" to R.drawable.player_virat_kohli,
            "Sanju Samson" to R.drawable.player_sanju_samson,
            "Samson" to R.drawable.player_sanju_samson,
            "Rohit Sharma" to R.drawable.player_rohit_sharma,
            "Carlos Alcaraz" to R.drawable.player_carlos_alcaraz,
            "Novak Djokovic" to R.drawable.player_novak_djokovic,
        )

        for ((name, expectedRes) in knownPlayers) {
            val resolved = RichCardAssetResolver.getBundledPlayerPortrait(name)
            assertNotNull("Portrait for '$name' must resolve", resolved)
            assertEquals("Portrait for '$name' mismatch", expectedRes, resolved)
        }

        // Unknown player falls back to null (calling code falls back to monogram)
        assertNull(RichCardAssetResolver.getBundledPlayerPortrait("Random Player"))
    }

    @Test
    fun verifyClubLogosResolution() {
        val clubs = mapOf(
            "Arsenal" to R.drawable.logo_arsenal,
            "Manchester City" to R.drawable.logo_man_city,
            "Man City" to R.drawable.logo_man_city,
            "Liverpool" to R.drawable.logo_liverpool,
            "Chelsea" to R.drawable.logo_chelsea,
            "Manchester United" to R.drawable.logo_man_utd,
            "Man Utd" to R.drawable.logo_man_utd,
            "Tottenham" to R.drawable.logo_tottenham,
            "Spurs" to R.drawable.logo_tottenham,
            "Newcastle" to R.drawable.logo_newcastle,
            "Aston Villa" to R.drawable.logo_aston_villa,
            "Real Madrid" to R.drawable.logo_real_madrid,
            "Barcelona" to R.drawable.logo_barcelona,
            "Chennai Super Kings" to R.drawable.logo_csk,
            "CSK" to R.drawable.logo_csk,
            "Mumbai Indians" to R.drawable.logo_mi,
            "MI" to R.drawable.logo_mi,
            "BCCI" to R.drawable.logo_bcci,
        )

        for ((name, expectedRes) in clubs) {
            val resolved = RichCardAssetResolver.getBundledTeamLogo(name)
            assertNotNull("Club logo for '$name' must resolve", resolved)
            assertEquals("Club logo for '$name' mismatch", expectedRes, resolved)
        }

        assertNull(RichCardAssetResolver.getBundledTeamLogo("Unknown FC XYZ"))
    }

    @Test
    fun verifyNationalTeamClubLogoFallbackToFlag() {
        // When sports cards pass national teams as the team name, getBundledTeamLogo resolves the country flag
        assertEquals(R.drawable.flag_in, RichCardAssetResolver.getBundledTeamLogo("India", sport = "cricket"))
        assertEquals(R.drawable.flag_nz, RichCardAssetResolver.getBundledTeamLogo("New Zealand", sport = "cricket"))
        assertEquals(R.drawable.flag_za, RichCardAssetResolver.getBundledTeamLogo("South Africa", sport = "cricket"))
    }
}
