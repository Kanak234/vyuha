/**
 * VYUHA example — binary search, one frame per probe.
 *
 * Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)
 * Needs Vyuha.java in the same folder (VYUHA: Add Helper Library).
 */
public class BinarySearch {
    public static void main(String[] args) {
        int[] a = {3, 8, 12, 19, 25, 31, 44, 52, 63, 77, 88, 91};
        int target = 63;

        Vyuha.array(a, "binary search", "looking for " + target);

        int lo = 0, hi = a.length - 1;
        while (lo <= hi) {
            int mid = (lo + hi) / 2;
            Vyuha.array(a, "binary search", "probe " + a[mid], lo, mid, hi);
            if (a[mid] == target) {
                Vyuha.array(a, "binary search", "found " + target + " at index " + mid, mid);
                return;
            }
            if (a[mid] < target) lo = mid + 1;
            else hi = mid - 1;
        }
        Vyuha.array(a, "binary search", target + " is not in the array");
    }
}
