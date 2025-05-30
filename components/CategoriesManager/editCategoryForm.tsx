import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Category, Item } from "@prisma/client";
import { SelectItemsTable } from "../ItemsManager/selectItemsTable";
import Image from "next/image";
import { XIcon } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { getItems } from "../ItemsManager/itemsManager";

// Simplified schema for categories
const formSchema = z.object({
  name: z.string().min(1, "Category name is required"),
  description: z.string().min(1, "Description is required"),
});

export function EditCategoryForm({
  category,
  open,
  onOpenChange,
  onSuccess,
}: {
  category: Category & { items: Item[] }; // Explicitly include the items relation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { user } = useUser();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectingItems, setSelectingItems] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: category.name,
      description: category.description || "",
    },
  });

  async function handleSubmit(values: z.infer<typeof formSchema>) {
    try {
      const response = await fetch("/api/category/edit-category", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            id: category.id,
            name: values.name,
            description: values.description,
            items: selectedItems,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update category");
      }

      onSuccess();
      onOpenChange(false);
      toast({ title: "Category updated successfully!" });
    } catch (error) {
      toast({
        title: "Failed to update category",
        variant: "destructive",
      });
    }
  }

  useEffect(() => {
    const fetchItems = async () => {
      if (user?.id) {
        try {
          setLoading(true);
          const items = await getItems(user.id);
          setItems(items);
        } catch (error) {
          toast({
            title: "Failed to load items",
            variant: "destructive",
          });
        } finally {
          setLoading(false);
        }
      }
    };

    fetchItems();
  }, []);

  // populate the already selected items
  useEffect(() => {
    setSelectedItems([...category.items]);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-md max-h-screen overflow-scroll">
        {!selectingItems ? (
          <div>
            <DialogHeader>
              <DialogTitle>Edit Category</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-6"
              >
                {/* Category Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Description */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="font-medium text-sm mb-3">Items</p>
                <Button
                  onClick={() => setSelectingItems(true)}
                  variant={"outline"}
                  className="w-full"
                >
                  Select Items
                </Button>
                {!selectedItems.length && (
                  <p className="font-light text-sm my-3">
                    No items selected yet.
                  </p>
                )}
                {selectedItems?.map((item: Item) => (
                  <div className="outline flex rounded-md h-20 mt-4 outline-slate-200 outline-1 flex-row items-center justify-between">
                    <div className="flex flex-row items-center space-x-4 mx-5">
                      <Image
                        width={10}
                        height={10}
                        src={item.imageUrl || "/placeholder.png"}
                        alt={item.name}
                        className="h-10 w-10 rounded object-cover"
                      />
                      <p className="text-sm leading-none">{item.name}</p>
                    </div>
                    <div className="flex flex-row items-center space-x-4 mx-5">
                      <p className="text-sm leading-none">${item.price}</p>
                      {/* Add leading-none */}
                      <Button
                        onClick={(e) => {
                          e.preventDefault();
                          setSelectedItems((prev) =>
                            prev.filter((i) => i.id !== item.id)
                          );
                        }}
                        className="h-6 w-6 p-1 ml-2" // Increased size and added padding
                        variant="outline"
                      >
                        <XIcon className="h-4 w-4" />
                        {/* Set explicit icon size */}
                      </Button>
                    </div>
                  </div>
                ))}

                <Button type="submit" className="w-full">
                  Save Changes
                </Button>
              </form>
            </Form>
          </div>
        ) : (
          <div>
            <DialogHeader>
              <DialogTitle className="my-4">Select Category Items</DialogTitle>
            </DialogHeader>
            {/* this component is just a copy of the items table */}
            {/* hence there are a bunch of unused functions */}
            <SelectItemsTable
              data={items}
              selectedItems={selectedItems} //
              onSelectionChange={setSelectedItems}
            />
            <div className="flex flex-row justify-evenly">
              <Button
                className="min-w-32"
                variant={"outline"}
                onClick={() => setSelectingItems(false)}
              >
                Cancel
              </Button>
              <Button
                className="min-w-32"
                onClick={() => {
                  setSelectingItems(false);
                }}
              >
                Add Items
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
