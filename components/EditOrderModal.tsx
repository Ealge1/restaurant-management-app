// components/EditOrderModal.tsx
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, PlusCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from "next/image";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// Use the same interfaces as CreateOrderModal
interface Modifier {
  id: string;
  name: string;
  price: number;
  stripePriceId?: string;
}

interface ModifierWithQuantity extends Modifier {
  quantity: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

interface OrderItem {
  id?: string;
  name: string;
  quantity: number;
  price: number;
  modifiers?: any[];
  notes?: string | null;
  itemId?: string | null;
  imageUrl?: string;
}

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  modifierGroups?: ModifierGroup[];
  stripePriceId?: string;
}

interface Category {
  id: string;
  name: string;
  items: MenuItem[];
}

interface Menu {
  id: string;
  name: string;
  categories: Category[];
}

interface EditOrderData {
  orderId: string;
  currentItems: OrderItem[];
  customerName: string;
  paymentIntentId: string | null;
}

interface EditOrderModalProps {
  open: boolean;
  onClose: () => void;
  orderData: EditOrderData;
  onUpdateOrder: (updatedItems: OrderItem[]) => Promise<void>;
}

// Reuse the same menu fetching function
async function getSiteMenu() {
  try {
    const response = await fetch("/api/menu/get-menu", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch menu: ${response.statusText}`);
    }

    return (await response.json()) as Menu[];
  } catch (error) {
    console.error("Error fetching menu:", error);
    throw error;
  }
}

export default function EditOrderModal({
  open,
  onClose,
  orderData,
  onUpdateOrder,
}: EditOrderModalProps) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [siteMenu, setSiteMenu] = useState<Menu[] | null>(null);
  const [activeTab, setActiveTab] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (open) {
      // Transform orderData.currentItems
      const initialItems = orderData.currentItems.map((item) => ({
        ...item,
        // Ensure modifiers is ALWAYS an array, regardless of what it was before
        modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      }));
      setItems(initialItems);
      loadMenu();
    }
  }, [open, orderData.currentItems]);

  async function loadMenu() {
    setLoading(true);
    try {
      const menu = await getSiteMenu();
      setSiteMenu(menu);
      if (menu?.[0]?.categories?.length) {
        setActiveTab(menu[0].categories[0].id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load menu.");
    } finally {
      setLoading(false);
    }
  }

  const handleQuantityChange = (index: number, delta: number) => {
    setItems((prevItems) => {
      const newItems = [...prevItems];
      const newQuantity = newItems[index].quantity + delta;
      if (newQuantity >= 1) {
        newItems[index].quantity = newQuantity;
      }
      return newItems;
    });
  };

  const handleRemoveItem = (index: number) => {
    setItems((prevItems) => prevItems.filter((_, i) => i !== index));
  };

  const handleAddItem = (menuItem: MenuItem) => {
    setItems((prevItems) => {
      // Check if item already exists
      const existingItemIndex = prevItems.findIndex(
        (item) => item.id === menuItem.id
      );

      if (existingItemIndex >= 0) {
        // If item exists, increment quantity
        const newItems = [...prevItems];
        newItems[existingItemIndex].quantity += 1;
        return newItems;
      } else {
        // Add as new item
        const newItem: OrderItem = {
          id: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          imageUrl: menuItem.imageUrl,
          modifiers: [], // Initialize modifiers to an empty array
        };
        return [...prevItems, newItem];
      }
    });
  };

  const handleConfirmUpdate = async () => {
    setIsUpdating(true);
    try {
      // Filter out items with 0 quantity just in case
      const validItems = items.filter((item) => item.quantity > 0);
      await onUpdateOrder(validItems);
    } catch (error) {
      console.error("Error updating order:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => {
      // Use Array.isArray to ensure we only operate on array values
      const modifiersTotal = Array.isArray(item.modifiers)
        ? item.modifiers.reduce(
            (modSum, modifier) => modSum + modifier.price * modifier.quantity,
            0
          )
        : 0;

      return sum + item.price * item.quantity + modifiersTotal;
    }, 0);
  };

  // Loading and Error states
  if (loading && open) return <LoadingState />;
  if (error && open) return <ErrorState error={error} />;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto grid grid-cols-2 gap-6">
        <DialogHeader className="col-span-2">
          <DialogTitle>
            Edit Order for {orderData.customerName} (
            {orderData.orderId.substring(0, 8)})
          </DialogTitle>
        </DialogHeader>

        {/* Current Order Items */}
        <div className="space-y-4">
          <h3 className="font-medium">Current Items</h3>
          <ScrollArea className="h-[400px] pr-4">
            {items.length === 0 ? (
              <p className="text-sm text-gray-500">No items in order.</p>
            ) : (
              items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2 border-b"
                >
                  <div className="flex items-center gap-2">
                    {item.imageUrl && (
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        width={40}
                        height={40}
                        className="rounded"
                      />
                    )}
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-gray-600">
                        ${item.price.toFixed(2)}
                      </p>
                      {/* Use Array.isArray to ensure we're only mapping over arrays */}
                      {Array.isArray(item.modifiers) &&
                        item.modifiers.map((modifier, modIndex) => (
                          <p key={modIndex} className="text-xs text-gray-500">
                            {modifier.name} x{modifier.quantity} (+
                            {(modifier.price * modifier.quantity).toFixed(2)})
                          </p>
                        ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleQuantityChange(index, -1)}
                      disabled={item.quantity <= 1}
                    >
                      -
                    </Button>
                    <span className="w-6 text-center">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleQuantityChange(index, 1)}
                    >
                      +
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500"
                      onClick={() => handleRemoveItem(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </ScrollArea>
          <div className="border-t pt-4">
            <div className="flex justify-between font-semibold">
              <span>Subtotal:</span>
              <span>${calculateSubtotal().toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Tax (8%):</span>
              <span>${(calculateSubtotal() * 0.08).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold mt-2">
              <span>Total:</span>
              <span>${(calculateSubtotal() * 1.08).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Menu Selection */}
        <div className="flex flex-col">
          <h3 className="font-medium">Add Items</h3>
          {siteMenu && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="sticky top-0 bg-white">
                {siteMenu[0].categories.map((category) => (
                  <TabsTrigger key={category.id} value={category.id}>
                    {category.name}
                  </TabsTrigger>
                ))}
              </TabsList>

              <ScrollArea className="h-[400px]">
                {siteMenu[0].categories.map((category) => (
                  <TabsContent key={category.id} value={category.id}>
                    <div className="grid gap-4">
                      {category.items.map((item) => (
                        <div
                          key={item.id}
                          className="border rounded-lg p-4 flex items-center justify-between cursor-pointer hover:shadow-lg"
                          onClick={() => handleAddItem(item)}
                        >
                          <div className="flex items-center">
                            <Image
                              src={item.imageUrl}
                              alt={item.name}
                              width={60}
                              height={60}
                              className="rounded-lg mr-4"
                            />
                            <div>
                              <h4 className="font-bold">{item.name}</h4>
                              <p className="text-sm text-gray-600">
                                {item.description}
                              </p>
                              <p>${item.price.toFixed(2)}</p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddItem(item);
                            }}
                          >
                            <PlusCircle className="h-4 w-4 mr-1" /> Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </ScrollArea>
            </Tabs>
          )}
        </div>

        <DialogFooter className="col-span-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={isUpdating}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={handleConfirmUpdate}
            disabled={isUpdating || items.length === 0}
          >
            {isUpdating ? "Updating..." : "Confirm & Update Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Sub-components for better organization
const LoadingState = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Loading Menu...</DialogTitle>
      </DialogHeader>
    </DialogContent>
  </Dialog>
);

const ErrorState = ({ error }: { error: string }) => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Error</DialogTitle>
        <DialogDescription>{error}</DialogDescription>
      </DialogHeader>
    </DialogContent>
  </Dialog>
);
