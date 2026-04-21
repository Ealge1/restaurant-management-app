// stores/cartStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CartItemModifier {
  id: string;
  name: string;
  price: number;
  stripePriceId: string;
  quantity: number;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
  stripePriceId: string;
  notes?: string; // optional per-item notes the customer can add
  modifiers?: CartItemModifier[];
}

interface CartStore {
  cartItems: CartItem[];
  sessionId: string | null;
  initializeSession: () => void;
  addToCart: (item: CartItem) => Promise<void>;
  removeFromCart: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  totalItems: () => number;
  totalPrice: () => number;
}

// Small helper: save cart to server, but don't swallow failures silently.
// If the server write fails, we log it so you can see it in devtools.
async function syncCartToServer(
  sessionId: string | null,
  cartItems: CartItem[]
) {
  if (!sessionId) return;
  try {
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, cartItems }),
    });
    if (!res.ok) {
      console.warn(
        "Cart sync failed:",
        res.status,
        await res.text().catch(() => "")
      );
    }
  } catch (err) {
    console.warn("Cart sync error:", err);
  }
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      cartItems: [],
      sessionId: null,

      initializeSession: () => {
        const sessionId =
          localStorage.getItem("sessionId") || crypto.randomUUID();
        if (!localStorage.getItem("sessionId")) {
          localStorage.setItem("sessionId", sessionId);
        }
        set({ sessionId });

        // Load from server (best-effort; local state is the fallback)
        fetch(`/api/cart?sessionId=${sessionId}`)
          .then((res) => (res.ok ? res.json() : []))
          .then((items) => {
            if (Array.isArray(items) && items.length > 0) {
              set({ cartItems: items });
            }
          })
          .catch((err) => console.warn("Cart load error:", err));
      },

      addToCart: async (item) => {
        const { sessionId, cartItems } = get();
        const existingItem = cartItems.find((i) => i.id === item.id);
        const newItems = existingItem
          ? cartItems.map((i) =>
              i.id === item.id
                ? { ...i, quantity: i.quantity + item.quantity }
                : i
            )
          : [...cartItems, item];

        set({ cartItems: newItems });
        await syncCartToServer(sessionId, newItems);
      },

      removeFromCart: async (itemId) => {
        const { sessionId, cartItems } = get();
        const newItems = cartItems.filter((item) => item.id !== itemId);

        set({ cartItems: newItems });
        await syncCartToServer(sessionId, newItems);
      },

      updateQuantity: async (itemId, quantity) => {
        const { sessionId, cartItems } = get();
        // Guard against invalid quantities
        if (!Number.isFinite(quantity) || quantity < 1) return;
        const newItems = cartItems.map((item) =>
          item.id === itemId ? { ...item, quantity } : item
        );

        set({ cartItems: newItems });
        await syncCartToServer(sessionId, newItems);
      },

      clearCart: async () => {
        const { sessionId } = get();
        set({ cartItems: [] });
        await syncCartToServer(sessionId, []);
      },

      totalItems: () =>
        get().cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0),

      totalPrice: () => {
        const total = get().cartItems.reduce((sum, item) => {
          const itemPrice = Number(item.price) || 0;
          const qty = Number(item.quantity) || 0;
          const modifierTotal = (item.modifiers ?? []).reduce(
            (mSum, m) => mSum + (Number(m.price) || 0) * (m.quantity || 1),
            0
          );
          return sum + (itemPrice + modifierTotal) * qty;
        }, 0);
        return Number.isFinite(total) ? total : 0;
      },
    }),
    {
      name: "cart-storage",
      partialize: (state) => ({
        sessionId: state.sessionId,
        cartItems: state.cartItems,
      }),
    }
  )
);
