"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ShadCN UI Components
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// Lucide Icons
import {
  Bell,
  Search,
  Clock,
  Package,
  Printer,
  ChevronDown,
  Filter,
  CheckCircle,
  ExternalLink,
  MapPin,
  Phone,
  Mail,
  AlertCircle,
  Plus,
  Edit,
  Truck,
} from "lucide-react";

// Custom Components
import CreateOrderModal from "@/components/CreateOrderModal";
import EditOrderModal from "@/components/EditOrderModal";

// Types
interface OrderItem {
  id?: string;
  name: string;
  quantity: number;
  price: number;
  modifiers?: any[];
  notes?: string | null;
  itemId?: string | null;
}

interface Order {
  id: string;
  status: string;
  orderNumber: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  total: number;
  subtotal: number;
  tax: number;
  tip?: number | null;
  deliveryFee?: number | null;
  items: OrderItem[];
  notes?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  paymentIntentId?: string | null;
  paymentStatus?: string | null;
  deliveryId?: string | null;
  deliveryStatus?: string | null;
  uberStatus?: string | null;
  uberTrackingUrl?: string | null;
  dasherName?: string | null;
  dasherPhone?: string | null;
  estimatedPickupTime?: string | null;
  estimatedDropoffTime?: string | null;
  doordashTrackingUrl?: string | null;
  doordashFee?: number | null;
  doordashStatus?: string | null;
  pickupTimeEstimated?: string | null;
  dropoffTimeEstimated?: string | null;
  supportReference?: string | null;
}

interface CreateOrderData {
  storeId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  notes?: string;
  items: {
    name: string;
    quantity: number;
    price: number;
    notes?: string;
  }[];
}

interface EditOrderData {
  orderId: string;
  currentItems: OrderItem[];
  customerName: string;
  paymentIntentId: string | null;
}

interface PrepTimeSetterProps {
  order: Order | null;
  onClose: () => void;
  onConfirm: (prepTime: number) => void;
}

const PrepTimeSetter: React.FC<PrepTimeSetterProps> = ({
  order,
  onClose,
  onConfirm,
}) => {
  const [prepTime, setPrepTime] = useState<number>(30);

  return (
    <Dialog open={!!order} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Set Preparation Time</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="mb-4">
            Set preparation time for order #{order?.orderNumber}
          </p>
          <div className="flex items-center">
            <Input
              type="number"
              value={prepTime}
              onChange={(e) => setPrepTime(Number(e.target.value))}
              className="mr-2"
              min={1}
            />
            <span>minutes</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(prepTime)}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const OrdersPage = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeTab, setActiveTab] = useState<string>("new");
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [prepTimeOrder, setPrepTimeOrder] = useState<Order | null>(null);
  const [newOrderAlertVisible, setNewOrderAlertVisible] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [showCreateOrderModal, setShowCreateOrderModal] = useState(false);
  const [showEditOrderModal, setShowEditOrderModal] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState<EditOrderData | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const groupOrders = (ordersToGroup: Order[]) => ({
    new: ordersToGroup.filter((order) => order.status === "NEW"),
    inProgress: ordersToGroup.filter((order) =>
      ["ACCEPTED", "PREPARING", "READY"].includes(order.status)
    ),
    completed: ordersToGroup.filter((order) =>
      ["COMPLETED", "CANCELED"].includes(order.status)
    ),
  });

  const groupedOrders = groupOrders(orders);

  const fetchOrders = useCallback(
    async (isInitial = false) => {
      if (isFetching && !isInitial) return;
      setIsFetching(true);
      console.log("Fetching orders...");
      try {
        const response = await fetch("/api/orders");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: Order[] = await response.json();

        setOrders((prevOrders) => {
          const currentNewOrderIds = new Set(
            prevOrders.filter((o) => o.status === "NEW").map((o) => o.id)
          );
          const incomingNewOrders = data.filter((o) => o.status === "NEW");
          const hasTrulyNewOrder = incomingNewOrders.some(
            (o) => !currentNewOrderIds.has(o.id)
          );

          if (hasTrulyNewOrder && !isInitial) {
            playAudio();
            setNewOrderAlertVisible(true);
            setTimeout(() => setNewOrderAlertVisible(false), 5000);
          }
          return data;
        });
      } catch (error: any) {
        console.error("Failed to fetch orders:", error);
      } finally {
        setIsFetching(false);
      }
    },
    [isFetching]
  );

  useEffect(() => {
    audioRef.current = new Audio(
      "https://upcdn.io/223k23J/raw/notification.mp3"
    );
    fetchOrders(true);

    const interval = setInterval(() => fetchOrders(), 30000);
    window.addEventListener("focus", () => fetchOrders());

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", () => fetchOrders());
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const currentTabOrders =
      groupedOrders[activeTab as keyof typeof groupedOrders];

    if (currentTabOrders.length > 0) {
      const activeOrderStillVisible = currentTabOrders.find(
        (order) => order.id === activeOrder?.id
      );
      if (activeOrderStillVisible) {
        setActiveOrder(activeOrderStillVisible);
      } else {
        setActiveOrder(currentTabOrders[0]);
      }
    } else {
      setActiveOrder(null);
    }
  }, [activeTab, orders, groupedOrders]);

  const playAudio = () => {
    if (audioRef.current) {
      audioRef.current.play().catch((error) => {
        console.warn(
          "Audio play failed (possibly due to autoplay restrictions):",
          error
        );
      });
    }
  };

  const handleAcceptOrderWithPrepTime = (order: Order) => {
    setPrepTimeOrder(order);
  };

  const handleClosePrepTime = () => {
    setPrepTimeOrder(null);
  };

  const handleConfirmPrepTime = async (prepTime: number) => {
    if (!prepTimeOrder) {
      alert("No order selected for prep time.");
      return;
    }

    const originalOrder = { ...prepTimeOrder };
    const originalOrders = [...orders];
    const originalTab = activeTab;

    // Optimistic UI update
    setActiveOrder({ ...prepTimeOrder, status: "ACCEPTED" });
    setOrders((prevOrders) =>
      prevOrders.map((order) =>
        order.id === prepTimeOrder.id ? { ...order, status: "ACCEPTED" } : order
      )
    );
    setActiveTab("inProgress");

    try {
      const response = await fetch(`/api/orders/${prepTimeOrder.id}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prepTime, id: prepTimeOrder.id }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to accept order");
      }

      setPrepTimeOrder(null);
      await fetchOrders();
    } catch (error: any) {
      console.error("Failed to accept order:", error);
      setActiveOrder(originalOrder);
      setOrders(originalOrders);
      setActiveTab(originalTab);
      alert(
        `Failed to accept order: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const handleMarkReady = async (orderId: string) => {
    if (!activeOrder || activeOrder.id !== orderId) return;

    const originalOrder = { ...activeOrder };
    const originalOrders = [...orders];

    setActiveOrder({ ...activeOrder, status: "READY" });
    setOrders((prevOrders) =>
      prevOrders.map((order) =>
        order.id === orderId ? { ...order, status: "READY" } : order
      )
    );

    try {
      const response = await fetch(`/api/orders/${orderId}/ready`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to mark ready");
      }
      await fetchOrders();
    } catch (error: any) {
      console.error("Failed to mark order ready:", error);
      setActiveOrder(originalOrder);
      setOrders(originalOrders);
      alert(
        `Failed to mark order as ready: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const handleHandOff = async (orderId: string) => {
    if (!activeOrder || activeOrder.id !== orderId) return;

    const originalOrder = { ...activeOrder };
    const originalOrders = [...orders];
    const originalTab = activeTab;

    setActiveOrder({ ...activeOrder, status: "COMPLETED" });
    setOrders((prevOrders) =>
      prevOrders.map((order) =>
        order.id === orderId ? { ...order, status: "COMPLETED" } : order
      )
    );
    setActiveTab("completed");

    try {
      const response = await fetch(`/api/orders/${orderId}/complete`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to complete order");
      }
      await fetchOrders();
    } catch (error: any) {
      console.error("Failed to complete order:", error);
      setActiveOrder(originalOrder);
      setOrders(originalOrders);
      setActiveTab(originalTab);
      alert(
        `Failed to complete order: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const handlePrintReceipt = async (orderId: string) => {
    try {
      const response = await fetch(`/api/orders/${orderId}/print`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Print failed");
      }
      // Optionally show success message
    } catch (error: any) {
      console.error("Failed to print receipt:", error);
      alert(
        `Failed to print receipt: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!activeOrder || activeOrder.id !== orderId) return;
    if (
      !confirm(
        "Are you sure you want to cancel this order? This action might involve refunds and cannot always be undone."
      )
    )
      return;
  
    const originalOrder = { ...activeOrder };
    const originalOrders = [...orders];
    const originalTab = activeTab;
  
    setActiveOrder({ ...activeOrder, status: "CANCELED" });
    setOrders((prevOrders) =>
      prevOrders.map((order) =>
        order.id === orderId ? { ...order, status: "CANCELED" } : order
      )
    );
    setActiveTab("completed");
  
    try {
      const response = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: orderId }), // Send orderId in the request body
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to cancel order");
      }
      await fetchOrders();
    } catch (error: any) {
      console.error("Failed to cancel order:", error);
      setActiveOrder(originalOrder);
      setOrders(originalOrders);
      setActiveTab(originalTab);
      alert(
        `Failed to cancel order: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };
  

  const handleCreateOrder = async (orderData: CreateOrderData) => {
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create order");
      }

      setShowCreateOrderModal(false);
      await fetchOrders();
      setActiveTab("new");
      playAudio();
    } catch (error: any) {
      console.error("Failed to create order:", error);
      alert(
        `Failed to create order: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const handleOpenEditModal = (order: Order) => {
    if (!order || order.status !== "NEW") {
      alert("Only new orders can be edited.");
      return;
    }
    if (!order.paymentIntentId) {
      alert("Cannot edit order: Payment Intent ID is missing.");
      return;
    }
    setOrderToEdit({
      orderId: order.id,
      currentItems: order.items,
      customerName: order.customerName,
      paymentIntentId: order.paymentIntentId,
    });
    setShowEditOrderModal(true);
  };

  const handleUpdateOrder = async (updatedItems: OrderItem[], notes?: string) => {
    if (!orderToEdit || !orderToEdit.paymentIntentId) {
      alert("Cannot update order: Missing required information.");
      return;
    }
  
    try {
      // Make sure we have the orderId
      const orderId = orderToEdit.orderId;
      console.log("Updating order with ID:", orderId);
      
      const response = await fetch(`/api/orders/${orderId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          id: orderId, // Explicitly include the ID
          items: updatedItems,
          notes: notes
        }),
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update order");
      }
  
      setShowEditOrderModal(false);
      setOrderToEdit(null);
      await fetchOrders();
    } catch (error: any) {
      console.error("Failed to update order:", error);
      alert(
        `Failed to update order: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };
  

  const getDeliveryStatusColor = (status?: string | null) => {
    if (!status) return "bg-gray-100 text-gray-800";
    const statusLower = status.toLowerCase();
    if (statusLower.includes("pending")) return "bg-gray-100 text-gray-800";
    if (statusLower.includes("assigning_courier"))
      return "bg-yellow-100 text-yellow-800";
    if (statusLower.includes("waiting_for_pickup"))
      return "bg-blue-100 text-blue-800";
    if (statusLower.includes("picked_up"))
      return "bg-indigo-100 text-indigo-800";
    if (statusLower.includes("en_route_to_dropoff"))
      return "bg-purple-100 text-purple-800";
    if (statusLower.includes("arrived_at_dropoff"))
      return "bg-teal-100 text-teal-800";
    if (statusLower.includes("delivered")) return "bg-green-100 text-green-800";
    if (statusLower.includes("canceled")) return "bg-red-100 text-red-800";
    if (statusLower.includes("failed")) return "bg-red-100 text-red-800";
    return "bg-gray-100 text-gray-800";
  };

  const formatDeliveryStatus = (status?: string | null) => {
    if (!status) return "N/A";
    return status
      .toLowerCase()
      .replace(/_/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const formatDateTime = (dateString?: string | null | Date) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return "Invalid Date";
    }
  };

  const getOrderStatusColor = (status: string) => {
    switch (status) {
      case "NEW":
        return "bg-yellow-100 text-yellow-800";
      case "ACCEPTED":
        return "bg-blue-100 text-blue-800";
      case "PREPARING":
        return "bg-purple-100 text-purple-800";
      case "READY":
        return "bg-green-100 text-green-800";
      case "COMPLETED":
        return "bg-gray-100 text-gray-800";
      case "CANCELED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getPaymentStatusVariant = (
    status?: string | null
  ): "default" | "secondary" | "destructive" | "outline" => {
    if (!status) return "outline";
    switch (status) {
      case "succeeded":
        return "default";
      case "requires_capture":
        return "secondary";
      case "canceled":
        return "destructive";
      case "processing":
        return "outline";
      case "requires_payment_method":
        return "destructive";
      case "requires_confirmation":
        return "secondary";
      case "requires_action":
        return "secondary";
      case "failed":
        return "destructive";
      case "capture_failed":
        return "destructive";
      case "refunded":
        return "outline";
      default:
        return "outline";
    }
  };

  const getActionButton = (order: Order) => {
    if (!order) return null;

    if (order.status === "NEW") {
      return (
        <Button
          className="bg-green-600 hover:bg-green-700 text-white w-full"
          onClick={() => handleAcceptOrderWithPrepTime(order)}
          disabled={
            order.paymentStatus === "failed" ||
            order.paymentStatus === "canceled"
          }
        >
          Accept & Capture Payment
        </Button>
      );
    }

    if (order.status === "ACCEPTED" || order.status === "PREPARING") {
      return (
        <Button
          className="bg-blue-500 hover:bg-blue-600 text-white w-full"
          onClick={() => handleMarkReady(order.id)}
        >
          <CheckCircle className="mr-1 h-4 w-4" />
          Mark as Ready
        </Button>
      );
    }

    if (order.status === "READY") {
      return (
        <Button
          className="bg-blue-500 hover:bg-blue-600 text-white w-full"
          onClick={() => handleHandOff(order.id)}
        >
          <Truck className="mr-2 h-4 w-4" />
          Mark Picked Up / Complete
        </Button>
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden">
      <audio
        ref={audioRef}
        src="https://upcdn.io/223k23J/raw/notification.mp3"
        preload="auto"
      />

      <div className="bg-white p-3 flex items-center border-b shrink-0">
        <div className="flex-1">
          <div className="font-bold text-lg">
            Orders <ChevronDown className="inline h-4 w-4" />
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="default"
            onClick={() => setShowCreateOrderModal(true)}
            className="mr-2"
          >
            <Plus className="h-4 w-4 mr-1" /> New Order
          </Button>
          <div className="relative">
            <Input placeholder="Search..." className="pl-8 w-[220px]" />
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-500" />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="relative">
            <Bell className="h-4 w-4" />
            {groupedOrders.new.length > 0 && (
              <Badge className="absolute -top-1 -right-1 bg-red-500 text-white h-5 w-5 flex items-center justify-center p-0 text-xs rounded-full">
                {groupedOrders.new.length}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full bg-white shrink-0"
      >
        <TabsList className="grid w-full grid-cols-3 border-b">
          {(
            Object.entries({
              new: "New",
              inProgress: "In Progress",
              completed: "Completed",
            }) as [string, string][]
          ).map(([tabKey, tabName]) => (
            <TabsTrigger
              key={tabKey}
              value={tabKey as "new" | "inProgress" | "completed"}
              className="relative data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-blue-600"
            >
              {tabName}
              <Badge
                className="ml-2 px-1.5 py-0.5 text-xs"
                variant={activeTab === tabKey ? "default" : "secondary"}
              >
                {groupedOrders[tabKey as keyof typeof groupedOrders].length}
              </Badge>
              {tabKey === "new" && newOrderAlertVisible && (
                <span className="absolute top-1 right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/3 border-r overflow-y-auto bg-white">
          {groupedOrders[activeTab as keyof typeof groupedOrders].length ===
          0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4 text-center">
              <Package className="h-12 w-12 mb-4 text-gray-400" />
              <p>
                No {activeTab === "inProgress" ? "in progress" : activeTab}{" "}
                orders found.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {groupedOrders[activeTab as keyof typeof groupedOrders].map(
                (order) => (
                  <div
                    key={order.id}
                    className={`p-3 cursor-pointer hover:bg-gray-50 ${
                      activeOrder?.id === order.id
                        ? "bg-blue-50 border-l-4 border-blue-500"
                        : ""
                    }`}
                    onClick={() => setActiveOrder(order)}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-sm truncate pr-2">
                        {order.customerName}
                      </span>
                      <span className="text-sm font-medium">
                        ${order.total?.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-500 mb-1">
                      <span>#{order.orderNumber}</span>
                      <span>
                        {order.customerAddress ? "Delivery" : "Pickup"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className={`text-xs ${getOrderStatusColor(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </Badge>
                      {order.customerAddress && order.uberStatus && (
                        <Badge
                          variant="outline"
                          className={`text-xs ${getDeliveryStatusColor(
                            order.uberStatus
                          )}`}
                        >
                          {formatDeliveryStatus(order.uberStatus)}
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div className="flex-1 bg-gray-50 overflow-y-auto">
          {activeOrder ? (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {activeOrder.customerName}
                    </h2>
                    <p className="text-sm text-gray-500">
                      #{activeOrder.orderNumber}
                    </p>
                  </div>
                  <Badge className={getOrderStatusColor(activeOrder.status)}>
                    {activeOrder.status}
                  </Badge>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-white p-3 rounded-md border">
                  <h3 className="text-sm font-medium mb-2 text-gray-700">
                    Customer Information
                  </h3>
                  <div className="space-y-1 text-sm">
                    {activeOrder.customerPhone && (
                      <div className="flex items-center">
                        <Phone className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{activeOrder.customerPhone}</span>
                      </div>
                    )}
                    {activeOrder.customerEmail && (
                      <div className="flex items-center">
                        <Mail className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{activeOrder.customerEmail}</span>
                      </div>
                    )}
                    {activeOrder.customerAddress && (
                      <div className="flex items-start">
                        <MapPin className="h-4 w-4 mr-2 text-gray-400 mt-0.5 shrink-0" />
                        <span>{activeOrder.customerAddress}</span>
                      </div>
                    )}
                    {activeOrder.notes && (
                      <div className="flex items-start pt-1 text-yellow-700">
                        <AlertCircle className="h-4 w-4 mr-2 text-yellow-500 mt-0.5 shrink-0" />
                        <span className="italic">{activeOrder.notes}</span>
                      </div>
                    )}
                  </div>
                </div>

                {activeOrder.customerAddress && (
                  <div className="bg-white p-3 rounded-md border">
                    <h3 className="text-sm font-medium mb-2 text-gray-700">
                      Delivery Details
                    </h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <div className="text-gray-500">Status</div>
                        <Badge
                          className={`mt-0.5 ${getDeliveryStatusColor(
                            activeOrder.uberStatus
                          )}`}
                        >
                          {formatDeliveryStatus(activeOrder.uberStatus)}
                        </Badge>
                      </div>
                      {activeOrder.uberTrackingUrl && (
                        <div>
                          <div className="text-gray-500">Tracking</div>
                          <a
                            href={activeOrder.uberTrackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-blue-600 hover:underline"
                          >
                            <ExternalLink className="mr-1 h-3 w-3" />
                            View Live Tracking
                          </a>
                        </div>
                      )}
                      {activeOrder.estimatedPickupTime && (
                        <div>
                          <div className="text-gray-500">Est. Pickup</div>
                          <div className="flex items-center">
                            <Clock className="mr-1 h-3 w-3" />
                            {formatDateTime(activeOrder.estimatedPickupTime)}
                          </div>
                        </div>
                      )}
                      {activeOrder.estimatedDropoffTime && (
                        <div>
                          <div className="text-gray-500">Est. Delivery</div>
                          <div className="flex items-center">
                            <MapPin className="mr-1 h-3 w-3" />
                            {formatDateTime(activeOrder.estimatedDropoffTime)}
                          </div>
                        </div>
                      )}
                      {activeOrder.dasherName && (
                        <div className="col-span-2">
                          <div className="text-gray-500">Courier</div>
                          <div className="flex items-center gap-2">
                            <span>{activeOrder.dasherName}</span>
                            {activeOrder.dasherPhone && (
                              <span className="text-gray-600 text-xs">
                                ({activeOrder.dasherPhone})
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-white p-3 rounded-md border">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-medium text-gray-700">
                      Order Items
                    </h3>
                    {activeOrder.status === "NEW" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEditModal(activeOrder)}
                      >
                        <Edit className="h-4 w-4 mr-1" /> Edit Items
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {activeOrder.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-start text-sm border-b last:border-b-0 py-1"
                      >
                        <div className="w-8 text-center font-medium">
                          {item.quantity}x
                        </div>
                        <div className="flex-1 px-2">{item.name}</div>
                        <div
                          className="w-16 text-

right"
                        >
                          ${(item.price * item.quantity).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white p-3 rounded-md border">
                  <h3 className="text-sm font-medium mb-2 text-gray-700">
                    Transaction Details
                  </h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Subtotal</span>
                      <span>${activeOrder.subtotal?.toFixed(2)}</span>
                    </div>
                    {activeOrder.tax > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Tax</span>
                        <span>${activeOrder.tax.toFixed(2)}</span>
                      </div>
                    )}
                    {activeOrder.tip !== undefined &&
                      activeOrder.tip !== null &&
                      activeOrder.tip > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Tip</span>
                          <span>${activeOrder.tip.toFixed(2)}</span>
                        </div>
                      )}
                    {activeOrder.deliveryFee !== undefined &&
                      activeOrder.deliveryFee !== null &&
                      activeOrder.deliveryFee > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Delivery Fee</span>
                          <span>${activeOrder.deliveryFee.toFixed(2)}</span>
                        </div>
                      )}
                    <div className="flex justify-between font-semibold pt-1 border-t mt-1">
                      <span>Total</span>
                      <span>${activeOrder.total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-3 rounded-md border">
                  <h3 className="text-sm font-medium mb-2 text-gray-700">
                    Payment Details
                  </h3>
                  <div className="space-y-1 text-sm">
                    {activeOrder.paymentIntentId && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Payment Intent</span>
                        <span className="font-mono text-xs bg-gray-100 px-1 rounded">
                          {activeOrder.paymentIntentId}
                        </span>
                      </div>
                    )}
                    {activeOrder.paymentStatus && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Status</span>
                        <Badge
                          variant={getPaymentStatusVariant(
                            activeOrder.paymentStatus
                          )}
                          className="capitalize text-xs"
                        >
                          {activeOrder.paymentStatus.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-3 border-t flex items-center gap-2 bg-white mt-auto shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Print Receipt"
                  onClick={() => handlePrintReceipt(activeOrder.id)}
                >
                  <Printer className="h-5 w-5" />
                </Button>

                {!["COMPLETED", "CANCELED"].includes(activeOrder.status) && (
                  <Button
                    variant="outline"
                    onClick={() => handleCancelOrder(activeOrder.id)}
                    className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  >
                    Cancel Order
                  </Button>
                )}

                <div className="flex-1"></div>

                <div className="min-w-[200px]">
                  {getActionButton(activeOrder)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
              <Package className="h-16 w-16 mb-4 text-gray-400" />
              <p>Select an order from the list to view details</p>
            </div>
          )}
        </div>
      </div>

      {prepTimeOrder && (
        <PrepTimeSetter
          order={prepTimeOrder}
          onClose={handleClosePrepTime}
          onConfirm={handleConfirmPrepTime}
        />
      )}

      <CreateOrderModal
        open={showCreateOrderModal}
        onClose={() => setShowCreateOrderModal(false)}
        onCreateOrder={handleCreateOrder}
      />

      {orderToEdit && (
        <EditOrderModal
          open={showEditOrderModal}
          onClose={() => {
            setShowEditOrderModal(false);
            setOrderToEdit(null);
          }}
          orderData={orderToEdit}
          onUpdateOrder={handleUpdateOrder}
        />
      )}
    </div>
  );
};

export default OrdersPage;
