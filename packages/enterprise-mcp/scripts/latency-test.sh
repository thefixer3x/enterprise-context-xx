#!/bin/bash
# =============================================================================
# Supabase Edge Function Latency Comparison Test
# Compares primary URL vs vanity subdomain response times
# =============================================================================

# Configuration
PRIMARY_URL="https://mxtsdgkwzjzlttpotole.supabase.co/functions/v1/intelligence-health-check"
VANITY_URL="https://lanonasis.supabase.co/functions/v1/intelligence-health-check"
ITERATIONS=${1:-10}
API_KEY="${LANONASIS_API_KEY:-lano_master_key_2024}"

echo "======================================================"
echo "  Supabase Edge Function Latency Comparison Test"
echo "======================================================"
echo ""
echo "Primary URL: $PRIMARY_URL"
echo "Vanity URL:  $VANITY_URL"
echo "Iterations:  $ITERATIONS"
echo ""

# Function to test a URL
test_url() {
    local url=$1
    local name=$2
    local total_time=0
    local total_dns=0
    local total_ttfb=0
    local min_time=999999
    local max_time=0
    local success=0

    echo "--- Testing: $name ---"
    echo "Warming up..."
    curl -s -o /dev/null -H "X-API-Key: $API_KEY" "$url"
    sleep 1

    echo "Running $ITERATIONS iterations..."

    for i in $(seq 1 $ITERATIONS); do
        # Get timing data
        result=$(curl -s -o /dev/null -w "%{time_namelookup} %{time_starttransfer} %{time_total} %{http_code}" \
            -H "X-API-Key: $API_KEY" \
            -H "Content-Type: application/json" \
            "$url")

        dns=$(echo "$result" | awk '{print $1}')
        ttfb=$(echo "$result" | awk '{print $2}')
        total=$(echo "$result" | awk '{print $3}')
        code=$(echo "$result" | awk '{print $4}')

        # Convert to ms
        dns_ms=$(echo "$dns * 1000" | bc)
        ttfb_ms=$(echo "$ttfb * 1000" | bc)
        total_ms=$(echo "$total * 1000" | bc)

        if [ "$code" = "200" ]; then
            status="OK"
            success=$((success + 1))
        else
            status="ERR:$code"
        fi

        printf "  [%2d/%d] %-6s Total: %6.0fms (DNS: %4.0fms, TTFB: %6.0fms)\n" \
            "$i" "$ITERATIONS" "$status" "$total_ms" "$dns_ms" "$ttfb_ms"

        # Accumulate
        total_time=$(echo "$total_time + $total" | bc)
        total_dns=$(echo "$total_dns + $dns" | bc)
        total_ttfb=$(echo "$total_ttfb + $ttfb" | bc)

        # Min/Max
        if (( $(echo "$total < $min_time" | bc -l) )); then
            min_time=$total
        fi
        if (( $(echo "$total > $max_time" | bc -l) )); then
            max_time=$total
        fi

        sleep 0.3
    done

    # Calculate averages
    avg_total=$(echo "scale=6; $total_time / $ITERATIONS" | bc)
    avg_dns=$(echo "scale=6; $total_dns / $ITERATIONS" | bc)
    avg_ttfb=$(echo "scale=6; $total_ttfb / $ITERATIONS" | bc)

    echo ""
    echo "Results for $name:"
    printf "  Avg DNS:   %6.2fms\n" "$(echo "$avg_dns * 1000" | bc)"
    printf "  Avg TTFB:  %6.2fms\n" "$(echo "$avg_ttfb * 1000" | bc)"
    printf "  Avg Total: %6.2fms\n" "$(echo "$avg_total * 1000" | bc)"
    printf "  Min/Max:   %.0fms / %.0fms\n" "$(echo "$min_time * 1000" | bc)" "$(echo "$max_time * 1000" | bc)"
    printf "  Success:   %d/%d\n" "$success" "$ITERATIONS"
    echo ""

    # Export for comparison
    eval "export ${name}_AVG=$avg_total"
    eval "export ${name}_DNS=$avg_dns"
    eval "export ${name}_TTFB=$avg_ttfb"
}

# Run tests
test_url "$PRIMARY_URL" "PRIMARY"
sleep 2
test_url "$VANITY_URL" "VANITY"

# Comparison
echo "======================================================"
echo "  COMPARISON"
echo "======================================================"
echo ""

diff_ms=$(echo "($VANITY_AVG - $PRIMARY_AVG) * 1000" | bc)
diff_dns_ms=$(echo "($VANITY_DNS - $PRIMARY_DNS) * 1000" | bc)
diff_ttfb_ms=$(echo "($VANITY_TTFB - $PRIMARY_TTFB) * 1000" | bc)

printf "%-15s %10s %10s %12s\n" "Metric" "Primary" "Vanity" "Difference"
printf "%-15s %10s %10s %12s\n" "---------------" "----------" "----------" "------------"
printf "%-15s %8.2fms %8.2fms %+10.2fms\n" "DNS Lookup" \
    "$(echo "$PRIMARY_DNS * 1000" | bc)" \
    "$(echo "$VANITY_DNS * 1000" | bc)" \
    "$diff_dns_ms"
printf "%-15s %8.2fms %8.2fms %+10.2fms\n" "TTFB" \
    "$(echo "$PRIMARY_TTFB * 1000" | bc)" \
    "$(echo "$VANITY_TTFB * 1000" | bc)" \
    "$diff_ttfb_ms"
printf "%-15s %8.2fms %8.2fms %+10.2fms\n" "Total" \
    "$(echo "$PRIMARY_AVG * 1000" | bc)" \
    "$(echo "$VANITY_AVG * 1000" | bc)" \
    "$diff_ms"

echo ""

# Verdict
diff_abs=$(echo "$diff_ms" | tr -d -)
if (( $(echo "$diff_abs > 100" | bc -l) )); then
    if (( $(echo "$diff_ms > 0" | bc -l) )); then
        echo "VERDICT: Vanity subdomain adds SIGNIFICANT latency (+${diff_ms}ms)"
    else
        echo "VERDICT: Vanity subdomain is SIGNIFICANTLY faster (${diff_ms}ms)"
    fi
elif (( $(echo "$diff_abs > 20" | bc -l) )); then
    if (( $(echo "$diff_ms > 0" | bc -l) )); then
        echo "VERDICT: Vanity subdomain adds minor latency (+${diff_ms}ms)"
    else
        echo "VERDICT: Vanity subdomain is slightly faster (${diff_ms}ms)"
    fi
else
    echo "VERDICT: No significant difference (${diff_ms}ms)"
fi

echo ""
